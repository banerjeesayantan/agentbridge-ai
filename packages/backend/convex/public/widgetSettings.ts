import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { assertOrgId } from "../lib/limits";
import { verifyWidgetInstallToken } from "../lib/widgetOrigin";

export const getByOrganizationId = action({
  args: { organizationId: v.string(), installToken: v.string() },
  handler: async (ctx, args) => {
    const organizationId = assertOrgId(args.organizationId);
    const claims = await verifyWidgetInstallToken(args.installToken, organizationId);
    const settings = await ctx.runQuery(internal.system.widgetInstallations.getSettings, {
      organizationId,
      origin: claims.origin,
    });
    if (!settings) throw new ConvexError({ code: "UNAUTHORIZED", message: "Widget origin is no longer authorized." });
    return settings;
  },
});
