import { ConvexError } from "convex/values";
import { query } from "../_generated/server";


/**
 * Dashboard view of the Free-plan voice demo for the caller's organization.
 * Read-only and presentation-only: the demo itself is enforced by public/voiceDemo.ts
 * and system/voiceDemo.ts. Never returns budgets, provider names or secrets.
 */
export const status = query({
  args: {},
  handler: async (ctx): Promise<{ demoEnabled: boolean; trialUsed: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Identity not found" });
    }
    const orgId = identity.orgId as string;
    if (!orgId) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Organization not found" });
    }
    const trial = await ctx.db
      .query("voiceTrials")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", orgId))
      .first();
    return { demoEnabled: process.env.VOICE_DEMO_ENABLED === "true", trialUsed: trial !== null };
  },
});
