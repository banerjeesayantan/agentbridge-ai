import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { getEntitlements } from "../lib/entitlements";

export type TrialReason = "invalid_session" | "use_paid" | "unavailable" | "trial_used" | "trial";

/**
 * Decide whether this visitor session may start the organization's ONE free
 * voice demo. Server-enforced and atomic: the trial row is the gate, so
 * calling Vapi directly cannot bypass it (the demo token is only minted here).
 */
export const authorize = internalMutation({
  args: { contactSessionId: v.id("contactSessions") },
  handler: async (ctx, args): Promise<{ allowed: boolean; reason: TrialReason; organizationId?: string }> => {
    const now = Date.now();
    const session = await ctx.db.get(args.contactSessionId);
    if (!session || session.expiresAt <= now) return { allowed: false, reason: "invalid_session" };
    const organizationId = session.organizationId;

    const entitlements = await getEntitlements(ctx, organizationId, now);
    // Paid organizations use the wallet-backed flow (`voicePaid.authorizeCall`).
    if (entitlements.limits.voice) return { allowed: false, reason: "use_paid" };

    if (!process.env.VAPI_DEMO_ASSISTANT_ID?.trim()) return { allowed: false, reason: "unavailable" };

    const existing = await ctx.db
      .query("voiceTrials")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", organizationId))
      .first();
    if (existing) return { allowed: false, reason: "trial_used" };

    await ctx.db.insert("voiceTrials", { organizationId, usedAt: now });
    return { allowed: true, reason: "trial", organizationId };
  },
});

/** The demo token could not be issued: give the trial back (no call can exist). */
export const release = internalMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("voiceTrials")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .take(5);
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
