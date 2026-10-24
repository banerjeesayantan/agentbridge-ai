import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { PLANS, resolveEntitlements, type PaidPlanKey } from "../lib/entitlements";
import { productIdForPlan } from "../lib/polarConfig";
import { checkoutBody, polarRequest } from "../lib/polarApi";

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
};

async function requireOrg(ctx: { auth: { getUserIdentity: () => Promise<any> } }, adminOnly: boolean) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new ConvexError({ code: "UNAUTHORIZED", message: "Identity not found" });
  const orgId = identity.orgId as string;
  if (!orgId) throw new ConvexError({ code: "UNAUTHORIZED", message: "Organization not found" });
  // Enforced whenever the Clerk JWT carries a role; without the claim we cannot tell.
  const role = identity.orgRole as string | undefined;
  if (adminOnly && role && role !== "org:admin") {
    throw new ConvexError({ code: "FORBIDDEN", message: "Only organization admins can manage billing." });
  }
  return { identity, orgId };
}

/** Plans shown on the billing page. Prices come from Polar, never from this repo. */
export const getCatalog = action({
  args: {},
  handler: async (ctx) => {
    await requireOrg(ctx, false);
    const paid: PaidPlanKey[] = ["pro", "business"];

    const plans = await Promise.all(
      paid.map(async (plan) => {
        const base = { plan, name: PLANS[plan].name, priceAmount: null as number | null, currency: null as string | null, interval: null as string | null };
        const productId = productIdForPlan(plan);
        if (!productId || !env("POLAR_ACCESS_TOKEN")) return { ...base, available: false, reason: "not_configured" as const };
        try {
          const product = await polarRequest<any>(`/v1/products/${encodeURIComponent(productId)}`, { method: "GET" });
          const price = product.prices?.find((p: any) => !p.is_archived) ?? product.prices?.[0];
          return {
            ...base,
            available: true,
            reason: null,
            priceAmount: typeof price?.price_amount === "number" ? price.price_amount : null,
            currency: price?.price_currency ?? null,
            interval: product.recurring_interval ?? price?.recurring_interval ?? null,
          };
        } catch (error) {
          console.error("Failed to load Polar product", plan, error);
          return { ...base, available: false, reason: "load_failed" as const };
        }
      }),
    );
    return { plans };
  },
});

/** Create a Polar checkout for the caller's organization. Returns the hosted URL. */
export const createCheckout = action({
  args: { plan: v.union(v.literal("pro"), v.literal("business")) },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const { identity, orgId } = await requireOrg(ctx, true);

    // The product comes from server config keyed by an allowlisted plan name;
    // nothing price- or product-related is accepted from the browser.
    const productId = productIdForPlan(args.plan);
    if (!productId) {
      throw new ConvexError({ code: "CONFIG_MISSING", message: `The ${PLANS[args.plan].name} plan is not available for purchase yet.` });
    }
    const appUrl = env("APP_URL");
    if (!appUrl) throw new ConvexError({ code: "CONFIG_MISSING", message: "APP_URL is not configured." });

    const subscription = await ctx.runQuery(internal.system.subscriptions.getByOrganizationId, { organizationId: orgId });
    if (resolveEntitlements(subscription, Date.now()).plan !== "free") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "This organization already has a paid plan. Use Manage subscription to change it." });
    }

    if (!env("POLAR_ACCESS_TOKEN")) {
      throw new ConvexError({ code: "CONFIG_MISSING", message: "Billing is not configured yet (POLAR_ACCESS_TOKEN is missing)." });
    }
    const base = appUrl.replace(/\/$/, "");
    try {
      const checkout = await polarRequest<{ url: string }>("/v1/checkouts/", {
        method: "POST",
        body: checkoutBody({
          productId,
          organizationId: orgId,
          email: typeof identity.email === "string" ? identity.email : undefined,
          successUrl: `${base}/billing?checkout=return`,
          returnUrl: `${base}/billing`,
        }),
      });
      return { url: checkout.url };
    } catch (error) {
      console.error("Polar checkout creation failed", error instanceof Error ? error.message : error);
      throw new ConvexError({ code: "BAD_GATEWAY", message: "Couldn't start checkout. Please try again in a moment." });
    }
  },
});

/** Polar customer portal (change plan, update card, cancel). */
export const createPortalSession = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const { orgId } = await requireOrg(ctx, true);
    try {
      if (!env("POLAR_ACCESS_TOKEN")) throw new ConvexError({ code: "CONFIG_MISSING", message: "Billing is not configured yet (POLAR_ACCESS_TOKEN is missing)." });
      const session = await polarRequest<{ customer_portal_url: string }>("/v1/customer-sessions/", {
        method: "POST",
        body: { external_customer_id: orgId },
      });
      return { url: session.customer_portal_url };
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      console.error("Failed to create Polar customer session", error);
      throw new ConvexError({ code: "NOT_FOUND", message: "No billing account found for this organization yet." });
    }
  },
});
