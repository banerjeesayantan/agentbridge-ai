
import { createClerkClient } from "@clerk/backend";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import {
  DENY_MESSAGES,
  type VoiceProviderId,
} from "../lib/voiceDemo";

type VoiceDemoAccess = {
  organizationId: string;
  paidVoice: boolean;
} | null;

type VoiceDemoReservation = {
  sessionId: Id<"voiceSessions">;
  provider: VoiceProviderId;
  maxSeconds: number;
  publicConfig: Record<string, string>;
};

type VoiceDemoFinishResult = {
  outcome: "completed" | "ended_short" | "released" | "expired";
  trialConsumed: boolean;
};

type VoiceDemoEligibility = {
  state:
    | "paid"
    | "available"
    | "trial_used"
    | "attempts_exceeded"
    | "unavailable"
    | "invalid";
};

/**
 * Browser entry points for the Free-plan voice demo.
 * Internal mutations enforce session ownership and manage reservations.
 * Only public provider configuration is returned to the browser.
 */

/** Verify that the organization exists in Clerk. Fail closed. */
async function organizationExists(
  organizationId: string,
): Promise<boolean> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();

  if (!secretKey) return false;

  try {
    await createClerkClient({ secretKey }).organizations.getOrganization({
      organizationId,
    });
    return true;
  } catch {
    return false;
  }
}

const fail = (code: keyof typeof DENY_MESSAGES): never => {
  throw new ConvexError({
    code,
    message: DENY_MESSAGES[code],
  });
};

/** Return only the eligibility state intended for the voice UI. */
export const getEligibility = action({
  args: {
    contactSessionId: v.id("contactSessions"),
  },

  handler: async (ctx, args): Promise<VoiceDemoEligibility> => {
    const access: VoiceDemoAccess = await ctx.runQuery(
      internal.system.voiceDemo.access,
      args,
    );

    if (!access) {
      return { state: "invalid" };
    }

    if (access.paidVoice) {
      return { state: "paid" };
    }

    return await ctx.runQuery(
      internal.system.voiceDemo.eligibility,
      { organizationId: access.organizationId },
    );
  },
});

/** Start a Free-plan demo. Paid organizations use their own voice setup. */
export const start = action({
  args: {
    contactSessionId: v.id("contactSessions"),
  },

  handler: async (ctx, args): Promise<VoiceDemoReservation> => {
    const access: VoiceDemoAccess = await ctx.runQuery(
      internal.system.voiceDemo.access,
      args,
    );

    if (!access) {
      return fail("SESSION_INVALID");
    }

    if (access.paidVoice) {
      throw new ConvexError({
        code: "USE_PLAN_VOICE",
        message:
          "Your plan includes voice. Use the voice assistant configured for your organization.",
      });
    }

    if (!(await organizationExists(access.organizationId))) {
      return fail("ORG_NOT_VERIFIED");
    }

    return await ctx.runMutation(
      internal.system.voiceDemo.reserve,
      {
        organizationId: access.organizationId,
        contactSessionId: args.contactSessionId,
      },
    );
  },
});

export const switchProvider = action({
  args: {
    sessionId: v.id("voiceSessions"),
    contactSessionId: v.id("contactSessions"),
    error: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<VoiceDemoReservation> => {
    return await ctx.runMutation(
      internal.system.voiceDemo.switchProvider,
      args,
    );
  },
});

export const markStarted = action({
  args: {
    sessionId: v.id("voiceSessions"),
    contactSessionId: v.id("contactSessions"),
    providerCallId: v.optional(v.string()),
  },

  handler: async (
    ctx,
    args,
  ): Promise<{ startedAt: number }> => {
    return await ctx.runMutation(
      internal.system.voiceDemo.markStarted,
      args,
    );
  },
});

export const finish = action({
  args: {
    sessionId: v.id("voiceSessions"),
    contactSessionId: v.id("contactSessions"),
    clientDurationSeconds: v.number(),
    userTurns: v.number(),
    error: v.optional(v.string()),
  },

  handler: async (
    ctx,
    args,
  ): Promise<VoiceDemoFinishResult> => {
    return await ctx.runMutation(
      internal.system.voiceDemo.finish,
      args,
    );
  },
});
