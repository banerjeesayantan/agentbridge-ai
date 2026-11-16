import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { loadCentralVapiCredentials } from "../lib/vapiCentral";

export type BindResult =
  | { ok: true; outcome: "bound" | "already_bound" }
  | { ok: false; code: string; retryable: boolean };

const fail = (code: string, retryable: boolean): BindResult => ({ ok: false, code, retryable });

const CLOCK_SKEW_MS = 60_000;

/**
 * Bind the call the browser reports to the reservation it was issued.
 *
 * The browser-supplied `providerCallId` is NEVER trusted on its own. The
 * reservation is named explicitly and must belong to the caller's session; the
 * call is then fetched from Vapi with the server-held private key and must:
 *   - have exactly this ID,
 *   - belong to the reservation's managed assistant,
 *   - be a web call,
 *   - have been created inside the window the reservation's token allowed.
 * Only then is it bound (`voiceWallet.bindCall`), and any provider report that
 * arrived early is settled.
 */
export const bindReportedCall = internalAction({
  args: {
    reservationId: v.id("voiceCallReservations"),
    contactSessionId: v.id("contactSessions"),
    providerCallId: v.string(),
  },
  handler: async (ctx, args): Promise<BindResult> => {
    const reservation = await ctx.runQuery(internal.system.voiceWallet.getReservationForBinding, {
      reservationId: args.reservationId,
      contactSessionId: args.contactSessionId,
    });
    if (!reservation.ok) return fail(reservation.code, false);
    if (reservation.alreadyBoundTo !== undefined) {
      if (reservation.alreadyBoundTo !== args.providerCallId) {
        return fail("RESERVATION_ALREADY_BOUND", false);
      }

      // A previous attempt may have committed the binding but failed while
      // settling a report that arrived before the binding.
      try {
        const settlement = await ctx.runMutation(
          internal.system.voiceWallet.settlePendingReport,
          { providerCallId: args.providerCallId },
        );

        if (!settlement.ok) {
          return fail("PENDING_REPORT_SETTLEMENT_FAILED", false);
        }

        return { ok: true, outcome: "already_bound" };
      } catch {
        // Keep this retryable: the binding is committed, but settlement
        // can be retried safely because the wallet ledger is idempotent.
        return fail("PENDING_REPORT_SETTLEMENT_RETRYABLE", true);
      }
    }

    const credentials = await loadCentralVapiCredentials();
    if (!credentials) {
      console.error("ALERT: central Vapi credentials unavailable");
      return fail("VERIFIER_UNAVAILABLE", true);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(args.providerCallId)}`, {
        method: "GET",
        headers: { authorization: `Bearer ${credentials.privateApiKey}`, accept: "application/json" },
        signal: controller.signal,
      });

      if (response.status === 404) return fail("CALL_NOT_FOUND", true); // may not be visible yet
      if (!response.ok) return fail("VERIFIER_ERROR", true);

      let call: Record<string, unknown>;
      try {
        call = (await response.json()) as Record<string, unknown>;
      } catch {
        return fail("VERIFIER_BAD_RESPONSE", true);
      }

      if (call.id !== args.providerCallId) return fail("CALL_ID_MISMATCH", false);
      if (call.assistantId !== reservation.assistantId) return fail("ASSISTANT_MISMATCH", false);
      if (call.type !== "webCall") return fail("UNSUPPORTED_CALL_TYPE", false);

      const createdAtMs = typeof call.createdAt === "string" ? Date.parse(call.createdAt) : NaN;
      if (!Number.isFinite(createdAtMs)) return fail("CALL_TIME_UNKNOWN", false);
      if (createdAtMs < reservation.createdAt - CLOCK_SKEW_MS || createdAtMs > reservation.tokenExpiresAt + CLOCK_SKEW_MS) {
        return fail("CALL_OUTSIDE_AUTHORIZATION_WINDOW", false);
      }

      const bound = await ctx.runMutation(internal.system.voiceWallet.bindCall, {
        reservationId: args.reservationId,
        providerCallId: args.providerCallId,
        assistantId: reservation.assistantId,
      });
      if (!bound.ok) return fail(bound.code, false);

      // If the provider's end-of-call report beat us here, settle it now.
      await ctx.runMutation(internal.system.voiceWallet.settlePendingReport, { providerCallId: args.providerCallId });
      return { ok: true, outcome: bound.outcome };
    } catch {
      return fail("VERIFIER_UNREACHABLE", true);
    } finally {
      clearTimeout(timeout);
    }
  },
});
