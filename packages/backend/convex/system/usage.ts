import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { getEntitlements } from "../lib/entitlements";

/**
 * Atomically consume usage for an organization.
 *
 * Counters are stored by organization, metric, and billing period.
 * An optional requestId deduplicates retries of the same logical operation.
 *
 * Callers must generate a unique requestId for each logical operation
 * and reuse that ID only when retrying that operation.
 */
export const consume = internalMutation({
  args: {
    organizationId: v.string(),
    metric: v.literal("aiMessages"),
    amount: v.optional(v.number()),
    requestId: v.optional(v.string()),
  },

  handler: async (ctx, args) => {
    const organizationId = args.organizationId;

    if (typeof organizationId !== "string" || !organizationId.trim()) {
      throw new ConvexError({
        code: "INVALID_ORGANIZATION",
        message: "A valid organization ID is required.",
      });
    }

    const amount = args.amount ?? 1;

    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ConvexError({
        code: "INVALID_AMOUNT",
        message: "Usage amount must be a positive integer.",
      });
    }

    const requestId = args.requestId;

    if (requestId !== undefined && !requestId.trim()) {
      throw new ConvexError({
        code: "INVALID_REQUEST_ID",
        message: "Request ID cannot be empty.",
      });
    }

    const ent = await getEntitlements(ctx, organizationId);
    const limit = ent.limits[args.metric];

    // Avoid consuming usage twice for a previously recorded operation.
    if (requestId !== undefined) {
      const prior = await ctx.db
        .query("usageEvents")
        .withIndex("by_org_request", (q) =>
          q
            .eq("organizationId", organizationId)
            .eq("requestId", requestId),
        )
        .unique();

      if (prior) {
        return {
          allowed: true as const,
          duplicate: true,
          limit,
          resetsAt: ent.periodEnd,
        };
      }
    }

    const row = await ctx.db
      .query("usage")
      .withIndex("by_org_metric_period", (q) =>
        q
          .eq("organizationId", organizationId)
          .eq("metric", args.metric)
          .eq("periodStart", ent.periodStart),
      )
      .unique();

    const used = row?.count ?? 0;

    if (used + amount > limit) {
      return {
        allowed: false as const,
        used,
        limit,
        resetsAt: ent.periodEnd,
      };
    }

    const newCount = used + amount;

    if (row) {
      await ctx.db.patch(row._id, {
        count: newCount,
      });
    } else {
      await ctx.db.insert("usage", {
        organizationId,
        metric: args.metric,
        periodStart: ent.periodStart,
        count: newCount,
      });
    }

    if (requestId !== undefined) {
      await ctx.db.insert("usageEvents", {
        organizationId,
        requestId,
      });
    }

    return {
      allowed: true as const,
      duplicate: false,
      used: newCount,
      limit,
      resetsAt: ent.periodEnd,
    };
  },
});