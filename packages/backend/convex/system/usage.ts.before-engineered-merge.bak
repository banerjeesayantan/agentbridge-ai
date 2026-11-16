import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { getEntitlements } from "../lib/entitlements";

/**
 * Atomically consume usage for an organization.
 *
 * Convex mutations are serialized transactions, so two concurrent requests
 * cannot both pass the check and exceed the limit. Counters live in the
 * database keyed by organization + period, so refreshing the browser cannot
 * reset them. Passing `requestId` makes a retried call count only once.
 */
export const consume = internalMutation({
  args: {
    organizationId: v.string(),
    metric: v.literal("aiMessages"),
    amount: v.optional(v.number()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const amount = args.amount ?? 1;
    const ent = await getEntitlements(ctx, args.organizationId);
    const limit = ent.limits[args.metric];

    if (args.requestId) {
      const prior = await ctx.db
        .query("usageEvents")
        .withIndex("by_org_request", (q) =>
          q.eq("organizationId", args.organizationId).eq("requestId", args.requestId!),
        )
        .unique();
      if (prior) return { allowed: true as const, duplicate: true, limit, resetsAt: ent.periodEnd };
    }

    const row = await ctx.db
      .query("usage")
      .withIndex("by_org_metric_period", (q) =>
        q.eq("organizationId", args.organizationId).eq("metric", args.metric).eq("periodStart", ent.periodStart),
      )
      .unique();
    const used = row?.count ?? 0;

    if (used + amount > limit) {
      return { allowed: false as const, used, limit, resetsAt: ent.periodEnd };
    }

    if (row) await ctx.db.patch(row._id, { count: used + amount });
    else
      await ctx.db.insert("usage", {
        organizationId: args.organizationId,
        metric: args.metric,
        periodStart: ent.periodStart,
        count: used + amount,
      });

    if (args.requestId) {
      await ctx.db.insert("usageEvents", { organizationId: args.organizationId, requestId: args.requestId });
    }

    return { allowed: true as const, duplicate: false, used: used + amount, limit, resetsAt: ent.periodEnd };
  },
});
