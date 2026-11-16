import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action } from "../_generated/server";
import { loadCentralVapiCredentials } from "../lib/vapiCentral";
import { signVapiPublicToken } from "../lib/vapiJwt";
import { readVoiceBudgetConfig } from "../lib/voiceBudget";
import { RATE } from "../lib/limits";
import { rateLimited } from "../lib/rateLimit";

/**
 * Paid voice entry point for the browser. The visitor sends ONLY a contact
 * session. The server resolves the organization, plan, assistant and budget,
 * holds the budget, and returns a short-lived token restricted to that one
 * assistant. The central Vapi private key stays on the server.
 *
 * Residual risk (Vapi documents no single-use or override restriction): a token
 * can be reused until it expires, and browser-supplied assistant overrides are
 * not documented as blocked. Compensating controls: short expiry, one allowed
 * assistant, no transient assistants, locked origins, a hard max duration on
 * the managed assistant, one open hold per organization, a budget hold sized to
 * a maximum-length call, after-the-fact override detection, and a hold that is
 * never released before a call could still exist.
 */

const MESSAGES: Record<string, string> = {
  VOICE_UNAVAILABLE: "Voice is temporarily unavailable.",
  SESSION_INVALID: "Your session is not valid. Please reload and try again.",
  PROVIDER_PAUSED: "Voice is temporarily unavailable.",
  ORG_SUSPENDED: "Voice is currently unavailable for this organization.",
  PLAN_REQUIRED: "Voice is not available right now.",
  NO_ASSISTANT: "Voice is not set up for this organization yet.",
  IN_PROGRESS: "A voice call is already in progress for this organization.",
  SESSION_LIMIT: "Too many voice attempts. Please try again later.",
  NO_BUDGET: "Voice is not available right now.",
};

export type PaidVoiceAuthorization = {
  token: string;
  assistantId: string;
  reservationId: Id<"voiceCallReservations">;
  expiresAt: number;
  maxCallSeconds: number;
};

export const authorizeCall = action({
  args: { contactSessionId: v.id("contactSessions") },
  handler: async (ctx, args): Promise<PaidVoiceAuthorization> => {
    const gate = await ctx.runMutation(internal.system.rateLimit.take, {
      key: `voice:s:${args.contactSessionId}`,
      ...RATE.voiceSession,
    });
    if (!gate.ok) rateLimited(gate.retryAfterMs);

    const reservation = await ctx.runMutation(internal.system.voiceWallet.reserveCall, {
      contactSessionId: args.contactSessionId,
    });
    // The denial was RETURNED by a committed mutation; only now do we throw.
    if (!reservation.ok) {
      throw new ConvexError({ code: reservation.code, message: MESSAGES[reservation.code] ?? MESSAGES.VOICE_UNAVAILABLE });
    }

    const cfg = readVoiceBudgetConfig(process.env);
    try {
      const credentials = await loadCentralVapiCredentials();
      if (!credentials) throw new Error("central credentials unavailable");
      const { token, expiresAt } = await signVapiPublicToken({
        orgId: credentials.orgId,
        privateKey: credentials.privateApiKey,
        assistantId: reservation.assistantId,
        allowedOrigins: cfg.allowedOrigins,
        now: Date.now(),
        expiresAt: reservation.tokenExpiresAt,
      });
      return {
        token,
        assistantId: reservation.assistantId,
        reservationId: reservation.reservationId,
        expiresAt,
        maxCallSeconds: reservation.maxCallSeconds,
      };
    } catch {
      // No token left the server, so no call can exist: release the hold now.
      // A REUSED reservation may already have a live token out, so it is left to expire.
      if (!reservation.reused) {
        await ctx.runMutation(internal.system.voiceWallet.releaseUnissued, {
          reservationId: reservation.reservationId,
        });
      }
      throw new ConvexError({ code: "VOICE_UNAVAILABLE", message: MESSAGES.VOICE_UNAVAILABLE });
    }
  },
});

const PROVIDER_CALL_ID = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * The browser reports the provider call ID it received from `vapi.start()`.
 * The ID is only a CLAIM: the server fetches the call from Vapi and verifies
 * assistant, call identity, type and time window before binding it to the
 * named reservation (see `system/voiceBinding.ts`). Bind failures that may
 * resolve on their own (call not visible yet) are returned with
 * `retryable: true` so the widget can retry briefly.
 */
export const reportCallStarted = action({
  args: {
    contactSessionId: v.id("contactSessions"),
    reservationId: v.id("voiceCallReservations"),
    providerCallId: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; retryable?: boolean; code?: string }> => {
    if (!PROVIDER_CALL_ID.test(args.providerCallId)) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Invalid call ID" });
    }
    const gate = await ctx.runMutation(internal.system.rateLimit.take, {
      key: `voice:report:s:${args.contactSessionId}`,
      ...RATE.voiceReportSession,
    });
    if (!gate.ok) rateLimited(gate.retryAfterMs);

    const result = await ctx.runAction(internal.system.voiceBinding.bindReportedCall, args);
    return result.ok ? { ok: true } : { ok: false, retryable: result.retryable, code: result.code };
  },
});
