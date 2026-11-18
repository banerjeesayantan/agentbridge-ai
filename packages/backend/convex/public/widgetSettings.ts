import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { assertOrgId } from "../lib/limits";
import { verifyWidgetInstallToken } from "../lib/widgetOrigin";

export const getByOrganizationId = query({
  args: { organizationId: v.string(), installToken: v.string() },
  handler: async (ctx, args) => {
    const organizationId = assertOrgId(args.organizationId);
    const claims = await verifyWidgetInstallToken(args.installToken, organizationId);
    const organization = await ctx.db.query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", organizationId))
      .first();
    const settings = await ctx.db.query("widgetSettings")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", organizationId))
      .unique();
    if (organization?.status !== "active" || !settings || !(settings.allowedOrigins ?? []).includes(claims.origin)) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Widget origin is no longer authorized." });
    }
    return {
      greetMessage: settings.greetMessage,
      defaultSuggestions: settings.defaultSuggestions,
      vapiSettings: settings.vapiSettings,
    };
  },
});
