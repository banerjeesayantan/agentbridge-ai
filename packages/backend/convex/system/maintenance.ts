import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

const BATCH = 200;
const DAY = 24 * 60 * 60 * 1000;

/** Abandoned visitor sessions: expired > 1 day ago AND not attached to any conversation. */
export const purgeExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - DAY;
    const expired = await ctx.db
      .query("contactSessions")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", cutoff))
      .take(BATCH);
    let deleted = 0;
    for (const session of expired) {
      const conversation = await ctx.db
        .query("conversations")
        .withIndex("by_contact_session_id", (q) => q.eq("contactSessionId", session._id))
        .first();
      // Sessions that own a conversation keep the visitor's contact details so
      // operators still see who they talked to; they live as long as it does.
      if (!conversation) {
        await ctx.db.delete(session._id);
        deleted++;
      }
    }
    if (expired.length === BATCH) await ctx.scheduler.runAfter(0, internal.system.maintenance.purgeExpiredSessions, {});
    return { deleted };
  },
});

/** Short-lived operational state. */
export const purgeEphemeral = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deleted = 0;
    const buckets = await ctx.db
      .query("rateLimits")
      .withIndex("by_updated_at", (q) => q.lt("updatedAt", now - 2 * DAY))
      .take(BATCH);
    for (const r of buckets) { await ctx.db.delete(r._id); deleted++; }
    const uploads = await ctx.db
      .query("fileUploads")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", now - 60 * 60 * 1000))
      .take(BATCH);
    for (const r of uploads) { await ctx.db.delete(r._id); deleted++; }
    if (buckets.length === BATCH || uploads.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.system.maintenance.purgeEphemeral, {});
    }
    return { deleted };
  },
});

/** Idempotency records are only needed while a provider could still redeliver (90 days). */
export const purgeOldEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 90 * DAY;
    let deleted = 0;
    const webhooks = await ctx.db.query("webhookEvents").withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff)).take(BATCH);
    for (const r of webhooks) { await ctx.db.delete(r._id); deleted++; }
    const processed = await ctx.db.query("processedProviderEvents").withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff)).take(BATCH);
    for (const r of processed) { await ctx.db.delete(r._id); deleted++; }
    const usageEvents = await ctx.db.query("usageEvents").withIndex("by_creation_time", (q) => q.lt("_creationTime", Date.now() - 62 * DAY)).take(BATCH);
    for (const r of usageEvents) { await ctx.db.delete(r._id); deleted++; }
    if (webhooks.length === BATCH || processed.length === BATCH || usageEvents.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.system.maintenance.purgeOldEvents, {});
    }
    return { deleted };
  },
});
