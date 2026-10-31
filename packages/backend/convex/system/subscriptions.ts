import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { getEntitlements as loadEntitlements, resolveEntitlements } from "../lib/entitlements";
import { decideSubscriptionEvent } from "../lib/Subscriptionevents";
// Kept for backwards compatibility with the former Clerk-driven flow.
// It must never touch a Polar-managed subscription: Polar events are the only
// source of truth for those rows (status, plan, periods, ownership).
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
      if (existingSubscription.polarSubscriptionId) {
        console.error("Refused legacy subscription upsert on a Polar-managed subscription", {
          organizationId: args.organizationId,
          polarSubscriptionId: existingSubscription.polarSubscriptionId,
        });
        return { applied: false as const, reason: "polar-managed" as const };
      }

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

    return { applied: true as const };
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
 * Record a verified webhook event that could not be applied, for
 * reconciliation. Deduplicated by Polar webhook-id, so redeliveries never
 * create a second row. Stores field names/types only, never raw payloads.
 */
export const recordWebhookFailure = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    organizationId: v.optional(v.string()),
    detail: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookFailures")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    if (existing) return { recorded: true as const, duplicate: true };

    await ctx.db.insert("webhookFailures", {
      eventId: args.eventId,
      type: args.type,
      reason: "malformed-linked-event",
      organizationId: args.organizationId,
      detail: args.detail,
      status: "open",
      receivedAt: Date.now(),
    });
    return { recorded: true as const, duplicate: false };
  },
});

/**
 * Apply one verified Polar subscription event.
 *  - Duplicate deliveries (same webhook-id) are ignored.
 *  - A Polar subscription ID owned by (or previously superseded for) a
 *    DIFFERENT organization is rejected ("wrong-organization"), recorded once
 *    in webhookFailures, and NOT marked as processed.
 *  - Older events for the same subscription (by Polar modified_at) are ignored.
 *  - Events for a *different* subscription never replace an organization that
 *    still has valid paid access (rejected events are NOT marked as processed).
 *  - A subscription that has been replaced can never become current again.
 * Decision rules live in ../lib/Subscriptionevents (pure, unit-tested).
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
    plan: v.optional(v.union(v.literal("pro"), v.literal("business"))),
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

    // Ownership guard: a Polar subscription ID belongs to exactly one
    // organization, whether it is current or already superseded. Runs before
    // any decision logic or write, in the same transaction, so it cannot race.
    const activeOwners = await ctx.db
      .query("subscriptions")
      .withIndex("by_polar_subscription_id", (q) =>
        q.eq("polarSubscriptionId", args.polarSubscriptionId),
      )
      .collect();
    const supersededOwners = await ctx.db
      .query("supersededSubscriptions")
      .withIndex("by_polar_subscription_id", (q) =>
        q.eq("polarSubscriptionId", args.polarSubscriptionId),
      )
      .collect();

    const ownedByAnotherOrganization =
      activeOwners.some((row) => row.organizationId !== args.organizationId) ||
      supersededOwners.some((row) => row.organizationId !== args.organizationId);

    if (ownedByAnotherOrganization) {
      // Deliberately NOT written to webhookEvents: a corrected redelivery or a
      // reconciliation run must be able to re-evaluate this event.
      const alreadyRecorded = await ctx.db
        .query("webhookFailures")
        .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
        .first();

      if (!alreadyRecorded) {
        await ctx.db.insert("webhookFailures", {
          eventId: args.eventId,
          type: args.type,
          reason: "wrong-organization",
          organizationId: args.organizationId,
          polarSubscriptionId: args.polarSubscriptionId,
          status: "open",
          receivedAt: now,
        });
      }

      console.error("ALERT: Polar subscription ownership conflict", {
        reason: "wrong-organization",
        eventId: args.eventId,
        eventType: args.type,
        incomingOrganizationId: args.organizationId,
        polarSubscriptionId: args.polarSubscriptionId,
      });

      return { applied: false as const, reason: "wrong-organization" as const };
    }

    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .unique();

    // Subscriptions this organization has already moved away from.
    const superseded = await ctx.db
      .query("supersededSubscriptions")
      .withIndex("by_organization_id_and_polar_subscription_id", (q) =>
        q.eq("organizationId", args.organizationId).eq("polarSubscriptionId", args.polarSubscriptionId),
      )
      .first();

    const decision = decideSubscriptionEvent({
      existing,
      incoming: {
        polarSubscriptionId: args.polarSubscriptionId,
        status: args.status,
        modifiedAt: args.modifiedAt,
      },
      incomingIsSuperseded: superseded !== null,
      now,
    });

    const recordEvent = () =>
      ctx.db.insert("webhookEvents", { eventId: args.eventId, type: args.type, receivedAt: now });

    if (decision.action === "ignore") {
      if (decision.recordEvent) await recordEvent();

      if (decision.reason !== "stale") {
        // Leave a trail: a rejected live subscription may mean a customer paid
        // for something that was not applied and needs reconciling.
        console.warn("Ignored Polar subscription event", {
          reason: decision.reason,
          organizationId: args.organizationId,
          currentSubscriptionId: existing?.polarSubscriptionId,
          incomingSubscriptionId: args.polarSubscriptionId,
          incomingStatus: args.status,
          eventType: args.type,
        });
      }

      return { applied: false as const, reason: decision.reason };
    }

    await recordEvent();

    if (decision.supersedes) {
      await ctx.db.insert("supersededSubscriptions", {
        organizationId: args.organizationId,
        polarSubscriptionId: decision.supersedes,
        supersededAt: now,
      });
    }

    const pastDueSince = decision.pastDueSince;

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