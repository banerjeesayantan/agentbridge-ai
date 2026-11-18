import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const getConfig = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.db.query("widgetSettings")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    const organization = await ctx.db.query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", args.organizationId))
      .first();
    if (!settings || organization?.status !== "active") return null;
    return { allowedOrigins: settings.allowedOrigins ?? [] };
  },
});
