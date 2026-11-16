
import { ConvexError } from "convex/values";
import { query } from "../_generated/server";

/**
 * Customer-facing Free voice trial status.
 * Organization scope comes exclusively from the authenticated identity.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (identity === null) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Identity not found",
      });
    }

    const organizationId = identity.orgId as string | undefined;

    if (!organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Organization not found",
      });
    }

    const demoEnabled = Boolean(
      process.env.VAPI_DEMO_ASSISTANT_ID?.trim(),
    );

    const trial = await ctx.db
      .query("voiceTrials")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", organizationId),
      )
      .unique();

    return {
      demoEnabled,
      trialUsed: trial !== null,
    };
  },
});
