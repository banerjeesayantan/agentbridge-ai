
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { getEntitlements } from "../lib/entitlements";

export const authorize = internalMutation({
  args: {
    organizationId: v.string(),
    contactSessionId: v.id("contactSessions"),
  },

  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify that the contact session belongs to this organization
    // and has not expired.
    const session = await ctx.db.get(args.contactSessionId);

    if (
      !session ||
      session.organizationId !== args.organizationId ||
      session.expiresAt <= now
    ) {
      return { allowed: false, reason: "invalid_session" as const };
    }

    // Existing paid entitlements take priority over the free trial.
    const entitlements = await getEntitlements(
      ctx,
      args.organizationId,
      now,
    );

    if (entitlements.limits.voice) {
      return { allowed: true, reason: "paid" as const };
    }

    // Free organizations receive one successful trial per organization.
    const existingTrial = await ctx.db
      .query("voiceTrials")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .unique();

    if (existingTrial) {
      return { allowed: false, reason: "trial_used" as const };
    }

    // Do not insert a voiceTrials record here:
    // no successful voice session exists yet.
    // The session completion flow records the trial using its sessionId.

    return { allowed: true, reason: "trial" as const };
  },
});
