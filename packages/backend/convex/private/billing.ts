import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action, type ActionCtx } from "../_generated/server";
import {
  PLANS,
  resolveEntitlements,
  type PaidPlanKey,
} from "../lib/entitlements";
import { productIdForPlan } from "../lib/polarConfig";
import { checkoutBody, polarRequest } from "../lib/polarApi";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const PAID_PLANS: PaidPlanKey[] = ["pro", "business"];
const ADMIN_ROLE = "org:admin";

/** Read an env var, treating empty or whitespace-only values as unset. */
const env = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

/** Throw a structured, client-readable error. */
const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

/** Return the Polar token or throw CONFIG_MISSING. */
const requirePolarToken = (): string =>
  env("POLAR_ACCESS_TOKEN") ??
  fail(
    "CONFIG_MISSING",
    "Billing is not configured yet (POLAR_ACCESS_TOKEN is missing).",
  );

/**
 * Read org claims from the Convex identity.
 *
 * Clerk's claim shape depends on the token version / JWT template:
 *   - camelCase template:  orgId, orgRole        ("org:admin")
 *   - legacy session:      org_id, org_role      ("org:admin")
 *   - compact v2 session:  o.id,   o.rol         ("admin")
 *
 * TODO: once you've confirmed which shape your deployment actually returns
 * (log `Object.keys(identity)` once in dev), delete the unused branches.
 */
function readOrgClaims(identity: Record<string, unknown>): {
  orgId: string | undefined;
  role: string | undefined;
} {
  const compact =
    typeof identity.o === "object" && identity.o !== null
      ? (identity.o as { id?: unknown; rol?: unknown })
      : undefined;

  const rawId = identity.orgId ?? identity.org_id ?? compact?.id;
  const rawRole = identity.orgRole ?? identity.org_role ?? compact?.rol;

  const role = typeof rawRole === "string" ? rawRole : undefined;

  return {
    orgId: typeof rawId === "string" ? rawId : undefined,
    // Compact tokens omit the "org:" prefix; normalize so the check below
    // stays a single strict comparison.
    role: role && !role.includes(":") ? `org:${role}` : role,
  };
}

/**
 * Authenticate the caller and resolve their organization.
 *
 * - The org ID comes ONLY from the authenticated identity, never from args.
 * - When `adminOnly` is true, a missing or non-admin role is rejected.
 */
async function requireOrg(ctx: Pick<ActionCtx, "auth">, adminOnly: boolean) {
  const identity = await ctx.auth.getUserIdentity();

  if (identity === null) {
    return fail("UNAUTHORIZED", "Identity not found");
  }

  const { orgId, role } = readOrgClaims(identity);

  if (!orgId || !orgId.trim()) {
    return fail("UNAUTHORIZED", "Organization not found");
  }

  // Missing or non-admin roles must never grant billing access.
  if (adminOnly && role !== ADMIN_ROLE) {
    return fail("FORBIDDEN", "Only organization admins can manage billing.");
  }

  return { identity, orgId };
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type PolarPrice = {
  is_archived?: boolean;
  price_amount?: number;
  price_currency?: string;
  recurring_interval?: string;
};

type PolarProduct = {
  prices?: PolarPrice[];
  recurring_interval?: string;
};

type CatalogPlan = {
  plan: PaidPlanKey;
  name: string;
  available: boolean;
  reason: "not_configured" | "load_failed" | null;
  priceAmount: number | null;
  currency: string | null;
  interval: string | null;
};

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Plans shown on the billing page.
 * Prices come from Polar, never from this repository.
 */
export const getCatalog = action({
  args: {},

  handler: async (ctx): Promise<{ plans: CatalogPlan[] }> => {
    await requireOrg(ctx, false);

    const hasToken = Boolean(env("POLAR_ACCESS_TOKEN"));

    const plans = await Promise.all(
      PAID_PLANS.map(async (plan): Promise<CatalogPlan> => {
        const base: CatalogPlan = {
          plan,
          name: PLANS[plan].name,
          available: false,
          reason: null,
          priceAmount: null,
          currency: null,
          interval: null,
        };

        const productId = productIdForPlan(plan);

        if (!productId || !hasToken) {
          return { ...base, reason: "not_configured" };
        }

        try {
          const product = await polarRequest<PolarProduct>(
            `/v1/products/${encodeURIComponent(productId)}`,
            { method: "GET" },
          );

          // Prefer an active price; fall back to the first one listed.
          const price =
            product.prices?.find((p) => !p.is_archived) ?? product.prices?.[0];

          return {
            ...base,
            available: true,
            priceAmount:
              typeof price?.price_amount === "number"
                ? price.price_amount
                : null,
            currency: price?.price_currency ?? null,
            interval:
              product.recurring_interval ?? price?.recurring_interval ?? null,
          };
        } catch (error) {
          console.error("Failed to load Polar product", plan, error);
          return { ...base, reason: "load_failed" };
        }
      }),
    );

    return { plans };
  },
});

/**
 * Create a Polar checkout for the caller's organization.
 * Returns the hosted checkout URL. Admin only.
 */
export const createCheckout = action({
  args: {
    plan: v.union(v.literal("pro"), v.literal("business")),
  },

  handler: async (ctx, args): Promise<{ url: string }> => {
    const { identity, orgId } = await requireOrg(ctx, true);

    // Only server-configured products for allowed plans can be purchased.
    const productId = productIdForPlan(args.plan);

    if (!productId) {
      return fail(
        "CONFIG_MISSING",
        `The ${PLANS[args.plan].name} plan is not available for purchase yet.`,
      );
    }

    const appUrl = env("APP_URL");

    if (!appUrl) {
      return fail("CONFIG_MISSING", "APP_URL is not configured.");
    }

    requirePolarToken();

    // Organizations that already have a paid plan must use the portal.
    const subscription = await ctx.runQuery(
      internal.system.subscriptions.getByOrganizationId,
      { organizationId: orgId },
    );

    if (resolveEntitlements(subscription, Date.now()).plan !== "free") {
      return fail(
        "BAD_REQUEST",
        "This organization already has a paid plan. Use Manage subscription to change it.",
      );
    }

    // Strip trailing slashes so generated return URLs stay valid.
    const baseUrl = appUrl.replace(/\/+$/, "");

    try {
      const checkout = await polarRequest<{ url: string }>("/v1/checkouts/", {
        method: "POST",
        body: checkoutBody({
          productId,
          organizationId: orgId,
          email: typeof identity.email === "string" ? identity.email : undefined,
          successUrl: `${baseUrl}/billing?checkout=return`,
          returnUrl: `${baseUrl}/billing`,
        }),
      });

      return { url: checkout.url };
    } catch (error) {
      console.error(
        "Polar checkout creation failed",
        error instanceof Error ? error.message : error,
      );

      return fail(
        "BAD_GATEWAY",
        "Couldn't start checkout. Please try again in a moment.",
      );
    }
  },
});

/**
 * Create a Polar customer portal session.
 * Lets organization admins manage billing and subscriptions.
 */
export const createPortalSession = action({
  args: {},

  handler: async (ctx): Promise<{ url: string }> => {
    const { orgId } = await requireOrg(ctx, true);

    // Checked outside the try block so config errors are never reported as 404s.
    requirePolarToken();

    try {
      const session = await polarRequest<{ customer_portal_url: string }>(
        "/v1/customer-sessions/",
        {
          method: "POST",
          body: { external_customer_id: orgId },
        },
      );

      return { url: session.customer_portal_url };
    } catch (error) {
      if (error instanceof ConvexError) {
        throw error;
      }

      console.error("Failed to create Polar customer session", error);

      return fail(
        "BAD_GATEWAY",
        "Couldn't open the billing portal. Please try again shortly.",
      );
    }
  },
});