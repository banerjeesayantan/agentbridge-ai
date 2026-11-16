import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { getEntitlements } from "../lib/entitlements";

/**
 * Request-level usage metering.
 *
 * Convex mutations are serialized transactions, so two concurrent requests
 * cannot both pass the limit check. Counters live in the database keyed by
 * organization + period, so refreshing the browser cannot reset them.
 *
 * Every metered operation passes a stable `requestId`:
 *  - a retry with the same id counts once (`duplicate: true`);
 *  - if the provider call then fails, `refund` reverses the units, and a later
 *    retry of the same request is charged again (it is allowed to succeed).
 */
const METRIC = v.literal("aiMessages");

async function findEvent(ctx: Pick<MutationCtx, "db">, organizationId: string, requestId: string) {
  return ctx.db
    .query("usageEvents")
    .withIndex("by_org_request", (q) => q.eq("organizationId", organizationId).eq("requestId", requestId))
    .first();
}

export const consume = internalMutation({
  args: {
    organizationId: v.string(),
    metric: METRIC,
    amount: v.optional(v.number()),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const amount = args.amount ?? 1;
    if (!Number.isInteger(amount) || amount < 1) throw new Error("amount must be a positive integer");

    const ent = await getEntitlements(ctx, args.organizationId);
    const limit = ent.limits[args.metric];
    const prior = await findEvent(ctx, args.organizationId, args.requestId);

    if (prior && prior.status !== "refunded") {
      return { allowed: true as const, duplicate: true, limit, resetsAt: ent.periodEnd };
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

    const event = {
      organizationId: args.organizationId,
      requestId: args.requestId,
      metric: args.metric,
      units: amount,
      status: "committed" as const,
      periodStart: ent.periodStart,
    };
    if (prior) await ctx.db.patch(prior._id, event);
    else await ctx.db.insert("usageEvents", event);

    return { allowed: true as const, duplicate: false, used: used + amount, limit, resetsAt: ent.periodEnd };
  },
});

/** Reverse a committed consumption (provider failed). Idempotent. */
export const refund = internalMutation({
  args: { organizationId: v.string(), requestId: v.string() },
  handler: async (ctx, args) => {
    const event = await findEvent(ctx, args.organizationId, args.requestId);
    if (!event || event.status === "refunded") return { refunded: false as const };

    const metric = event.metric ?? "aiMessages";
    const units = event.units ?? 1;
    // Legacy rows without a period cannot be refunded safely.
    if (event.periodStart === undefined) return { refunded: false as const };
    const periodStart = event.periodStart;

    const row = await ctx.db
      .query("usage")
      .withIndex("by_org_metric_period", (q) =>
        q.eq("organizationId", args.organizationId).eq("metric", metric).eq("periodStart", periodStart),
      )
      .unique();
    if (row) await ctx.db.patch(row._id, { count: Math.max(0, row.count - units) });
    await ctx.db.patch(event._id, { status: "refunded" });
    return { refunded: true as const };
  },
});
