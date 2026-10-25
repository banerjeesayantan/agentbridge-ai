
import { createClerkClient } from "@clerk/backend";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY || "",
});

type AuthorizeResult = {
  allowed: boolean;
  reason:
    | "invalid_organization"
    | "invalid_session"
    | "paid"
    | "trial"
    | "trial_used";
};

export const authorize = action({
  args: {
    organizationId: v.string(),
    contactSessionId: v.id("contactSessions"),
  },

  handler: async (ctx, args): Promise<AuthorizeResult> => {
    try {
      await clerkClient.organizations.getOrganization({
        organizationId: args.organizationId,
      });
    } catch {
      return { allowed: false, reason: "invalid_organization" };
    }

    return await ctx.runMutation(
      internal.system.voiceTrials.authorize,
      args,
    );
  },
});
