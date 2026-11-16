import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";
import { getSubscription } from "../lib/polarApi";
import { mapSubscriptionEvent } from "../lib/polarMapping";

export const listReconcilable = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("subscriptions").take(args.limit);
    return rows.filter((r) => r.polarSubscriptionId).map((r) => ({ organizationId: r.organizationId, polarSubscriptionId: r.polarSubscriptionId! }));
  },
});

/**
 * Daily recovery: re-read every known Polar subscription and apply the
 * provider's current state through the same ordered, idempotent path as
 * webhooks. Heals missed or permanently failed webhook deliveries.
 */
export const reconcileSubscriptions = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; applied: number; failed: number }> => {
    if (!process.env.POLAR_ACCESS_TOKEN) return { checked: 0, applied: 0, failed: 0 };
    const subs: Array<{ organizationId: string; polarSubscriptionId: string }> = await ctx.runQuery(internal.system.billingReconcile.listReconcilable, { limit: 500 });
    let applied = 0;
    let failed = 0;
    for (const sub of subs) {
      try {
        const data = (await getSubscription(sub.polarSubscriptionId)) as { modified_at?: string };
        const eventId = `reconcile:${sub.polarSubscriptionId}:${data.modified_at ?? "none"}`;
        const mapped = mapSubscriptionEvent("subscription.updated", data, eventId, Date.now());
        // Never let a reconcile response re-assign a subscription to another organization.
        if (!mapped || mapped.organizationId !== sub.organizationId) {
          failed++;
          continue;
        }
        const result = await ctx.runMutation(internal.system.subscriptions.applyPolarEvent, { ...mapped, type: "subscription.updated" });
        if (result.applied) {
          applied++;
          await ctx.scheduler.runAfter(0, internal.system.clerkSync.setMemberCap, {
            organizationId: sub.organizationId,
            memberCap: result.memberCap,
            attempt: 1,
          });
        }
      } catch (error) {
        failed++;
        console.error("Polar reconcile failed for a subscription", { organizationId: sub.organizationId, error: String(error).slice(0, 160) });
      }
    }
    if (failed > 0) console.error("ALERT: Polar reconcile had failures", { failed });
    return { checked: subs.length, applied, failed };
  },
});
