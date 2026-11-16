import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { RATE } from "../lib/limits";
import { rateLimited } from "../lib/rateLimit";
import { loadCentralVapiCredentials } from "../lib/vapiCentral";
import { signVapiPublicToken } from "../lib/vapiJwt";
import { readVoiceBudgetConfig } from "../lib/voiceBudget";

const DEMO_TOKEN_TTL_MS = 10 * 60 * 1000;

export type DemoAuthorization =
  | { allowed: false; reason: "invalid_session" | "use_paid" | "unavailable" | "trial_used" }
  | { allowed: true; reason: "trial"; token: string; assistantId: string; expiresAt: number };

/**
 * Free one-time voice demo for organizations without a voice plan. The
 * browser sends only its contact session; the demo assistant ID and a
 * short-lived restricted token are minted here, after the per-organization
 * trial has been atomically consumed. The platform pays for demo calls
 * (recorded as `free_demo` expenses by the Vapi webhook).
 */
export const authorize = action({
  args: { contactSessionId: v.id("contactSessions") },
  handler: async (ctx, args): Promise<DemoAuthorization> => {
    const gate = await ctx.runMutation(internal.system.rateLimit.take, {
      key: `voice:s:${args.contactSessionId}`,
      ...RATE.voiceSession,
    });
    if (!gate.ok) rateLimited(gate.retryAfterMs);

    const decision = await ctx.runMutation(internal.system.voiceTrials.authorize, args);
    if (!decision.allowed || !decision.organizationId) {
      return { allowed: false, reason: decision.reason as "invalid_session" | "use_paid" | "unavailable" | "trial_used" };
    }

    try {
      const assistantId = process.env.VAPI_DEMO_ASSISTANT_ID?.trim();
      if (!assistantId) throw new Error("Demo assistant is not configured");

      const credentials = await loadCentralVapiCredentials();
      if (!credentials) throw new Error("central credentials unavailable");
      const cfg = readVoiceBudgetConfig(process.env);
      const now = Date.now();
      const expiresAt = Math.ceil((now + DEMO_TOKEN_TTL_MS) / 1000) * 1000;
      const { token } = await signVapiPublicToken({
        orgId: credentials.orgId,
        privateKey: credentials.privateApiKey,
        assistantId,
        allowedOrigins: cfg.allowedOrigins,
        now,
        expiresAt,
      });
      return { allowed: true, reason: "trial", token, assistantId, expiresAt };
    } catch {
      // No token left the server, so no call can exist: give the trial back.
      await ctx.runMutation(internal.system.voiceTrials.release, { organizationId: decision.organizationId });
      throw new ConvexError({ code: "VOICE_UNAVAILABLE", message: "Voice is temporarily unavailable." });
    }
  },
});
