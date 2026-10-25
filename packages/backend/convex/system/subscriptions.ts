import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { getEntitlements as loadEntitlements, resolveEntitlements } from "../lib/entitlements";

// Kept for backwards compatibility with the former Clerk-driven flow.
export const upsert = internalMutation({
  args: {
    organizationId: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const existingSubscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .unique();

    if (existingSubscription) {
      await ctx.db.patch(existingSubscription._id, {
        status: args.status,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("subscriptions", {
        organizationId: args.organizationId,
        status: args.status,
        updatedAt: Date.now(),
      });
    }
  },
});

export const getByOrganizationId = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .unique();
  },
});

/**
 * Apply one verified Polar subscription event.
 *  - Duplicate deliveries (same webhook-id) are ignored.
 *  - Older events for the same subscription (by Polar modified_at) are ignored.
 *  - An end/cancel event for a *different* subscription never downgrades an
 *    organization whose current subscription is still live.
 */
export const applyPolarEvent = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    organizationId: v.string(),
    polarSubscriptionId: v.string(),
    polarCustomerId: v.optional(v.string()),
    polarProductId: v.optional(v.string()),
    polarPriceId: v.optional(v.string()),
    plan: v.optional(v.union(v.literal("pro"), v.literal("enterprise"))),
    status: v.string(),
    interval: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.boolean(),
    modifiedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const seen = await ctx.db
      .query("webhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (seen) return { applied: false as const, reason: "duplicate" as const };

    await ctx.db.insert("webhookEvents", { eventId: args.eventId, type: args.type, receivedAt: now });

    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .unique();

    if (existing?.polarSubscriptionId === args.polarSubscriptionId) {
      if ((existing.polarModifiedAt ?? 0) > args.modifiedAt) {
        return { applied: false as const, reason: "stale" as const };
      }
    } else if (existing?.polarSubscriptionId) {
      const current = resolveEntitlements(existing, now);
      const incomingLive = args.status === "active" || args.status === "trialing";
      if (current.plan !== "free" && !incomingLive) {
        return { applied: false as const, reason: "other-subscription" as const };
      }
    }

    const pastDueSince =
      args.status === "past_due" ? (existing?.status === "past_due" ? existing.pastDueSince ?? now : now) : undefined;

    const fields = {
      status: args.status,
      plan: args.plan,
      polarCustomerId: args.polarCustomerId,
      polarSubscriptionId: args.polarSubscriptionId,
      polarProductId: args.polarProductId,
      polarPriceId: args.polarPriceId,
      interval: args.interval,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      pastDueSince,
      polarModifiedAt: args.modifiedAt,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("subscriptions", { organizationId: args.organizationId, ...fields });
    }

    const resolved = resolveEntitlements({ ...fields }, now);
    return { applied: true as const, plan: resolved.plan, memberCap: resolved.limits.members };
  },
});

export const getEntitlements = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => loadEntitlements(ctx, args.organizationId),
});
