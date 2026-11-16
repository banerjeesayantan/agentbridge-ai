import { createClerkClient } from "@clerk/backend";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireEnv } from "../lib/env";

/** Mirror of Clerk organizations. Public endpoints trust this instead of calling Clerk. */
export const getStatus = internalQuery({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .first();
    return row ? row.status : null;
  },
});

export const upsert = internalMutation({
  args: { clerkOrgId: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .first();
    const doc = { clerkOrgId: args.clerkOrgId, name: args.name, status: "active" as const, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert("organizations", doc);
  },
});

export const markDeleted = internalMutation({
  args: { clerkOrgId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .first();
    if (row) await ctx.db.patch(row._id, { status: "deleted", updatedAt: Date.now() });
    else await ctx.db.insert("organizations", { clerkOrgId: args.clerkOrgId, status: "deleted", updatedAt: Date.now() });
  },
});

/**
 * One-off / recovery: copy every Clerk organization into the mirror.
 * Run once after deploying:  npx convex run system/organizations:backfill
 */
export const backfill = internalAction({
  args: {},
  handler: async (ctx) => {
    const clerk = createClerkClient({ secretKey: requireEnv("CLERK_SECRET_KEY") });
    let offset = 0;
    let total = 0;
    for (;;) {
      const page = await clerk.organizations.getOrganizationList({ limit: 100, offset });
      for (const org of page.data) {
        await ctx.runMutation(internal.system.organizations.upsert, { clerkOrgId: org.id, name: org.name });
        total++;
      }
      if (page.data.length < 100) break;
      offset += 100;
    }
    return { total };
  },
});
