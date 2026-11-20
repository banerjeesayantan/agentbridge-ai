import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { action } from "../_generated/server";
import { assertOrgId } from "../lib/limits";
import { signWidgetInstallToken, verifyWidgetInstallToken } from "../lib/widgetOrigin";
import { requireOrg } from "../lib/auth";

export const getByOrganizationId = action({
  args: { organizationId: v.string(), installToken: v.string() },
  handler: async (ctx, args): Promise<Doc<"widgetSettings">> => {
    const organizationId = assertOrgId(args.organizationId);
    const claims = await verifyWidgetInstallToken(args.installToken, organizationId);
    const settings: Doc<"widgetSettings"> | null = claims.preview
      ? await ctx.runQuery(internal.system.widgetInstallations.getPreviewSettings, { organizationId })
      : await ctx.runQuery(internal.system.widgetInstallations.getSettings, {
          organizationId,
          origin: claims.origin,
        });
    if (!settings) throw new ConvexError({ code: "UNAUTHORIZED", message: "Widget origin is no longer authorized." });
    return settings;
  },
});

export const getPreviewToken = action({
  args: { origin: v.string() },
  handler: async (ctx, args): Promise<{ token: string; expiresAt: number }> => {
    // Derive tenant and user from the verified Clerk identity; never accept an
    // organization ID supplied by the browser for preview authorization.
    const auth = await requireOrg(ctx);
    const organizationId = assertOrgId(auth.orgId);

    let origin: string;
    try {
      const url = new URL(args.origin);
      const local =
        url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1");
      if (url.origin !== args.origin || (url.protocol !== "https:" && !local)) {
        throw new Error("Invalid preview origin");
      }
      origin = url.origin;
    } catch {
      throw new ConvexError({ code: "BAD_REQUEST", message: "A valid HTTPS preview origin is required." });
    }

    const config = await ctx.runQuery(internal.system.widgetInstallations.getConfig, { organizationId });
    if (!config) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "The organization is not active." });
    }

    const gate = await ctx.runMutation(internal.system.rateLimit.take, {
      key: `widget-preview:${organizationId}:${auth.userId}`,
      capacity: 20,
      refillPerSecond: 1 / 60,
    });
    if (!gate.ok) {
      throw new ConvexError({ code: "TOO_MANY_REQUESTS", message: "Too many preview authorizations. Try again shortly." });
    }

    const issuedAt = Date.now();
    const expiresAt = issuedAt + 10 * 60_000;
    const token = await signWidgetInstallToken({
      organizationId,
      origin,
      issuedAt,
      expiresAt,
      preview: true,
    });
    return { token, expiresAt };
  },
});
