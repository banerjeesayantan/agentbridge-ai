import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export const getConfig = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args): Promise<{ allowedOrigins: string[] } | null> => {
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

export const getSettings = internalQuery({
  args: { organizationId: v.string(), origin: v.string() },
  handler: async (ctx, args): Promise<Doc<"widgetSettings"> | null> => {
    const organization = await ctx.db.query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", args.organizationId))
      .first();
    const settings = await ctx.db.query("widgetSettings")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    if (organization?.status !== "active" || !settings || !(settings.allowedOrigins ?? []).includes(args.origin)) return null;
    return settings;
  },
});


/**
 * Playground-only settings access. The caller must first present a short-lived
 * preview token minted by the authenticated getPreviewToken action.
 */
export const getPreviewSettings = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args): Promise<Doc<"widgetSettings"> | null> => {
    const organization = await ctx.db.query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", args.organizationId))
      .first();
    const settings = await ctx.db.query("widgetSettings")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    if (organization?.status !== "active" || !settings) return null;
    return settings;
  },
});
