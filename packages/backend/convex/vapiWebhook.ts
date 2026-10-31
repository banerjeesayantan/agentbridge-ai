import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { bearerMatches, parseEndOfCallReport } from "../convex/lib/vapiReport";

const MAX_BODY_CHARS = 1_000_000;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * POST /vapi/webhook: Vapi's end-of-call report for the Free-plan voice demo.
 *
 * Order matters: configuration, then authentication, then the body is read, then
 * validated, and only then is the (idempotent) mutation called. Rejections log a
 * reason only, never the token, the body or the transcript.
 */
export const vapiWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.VAPI_WEBHOOK_SECRET?.trim();
  const expectedAssistantId = process.env.VAPI_DEMO_ASSISTANT_ID?.trim();
  if (!secret || !expectedAssistantId) {
    console.error("ALERT: Vapi webhook is not configured (VAPI_WEBHOOK_SECRET / VAPI_DEMO_ASSISTANT_ID)");
    return json(500, { error: "not-configured" });
  }

  if (!(await bearerMatches(request.headers.get("authorization"), secret))) {
    console.warn("Vapi webhook rejected: unauthorized");
    return json(401, { error: "unauthorized" });
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) return json(413, { error: "too-large" });
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return json(413, { error: "too-large" });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "invalid-json" });
  }

  const decision = parseEndOfCallReport(body, expectedAssistantId);
  if (decision.kind === "ignore") return json(200, { ok: true, ignored: true });
  if (decision.kind === "reject") {
    console.warn("Vapi webhook rejected", { reason: decision.error });
    return json(decision.status, { error: decision.error });
  }
  if (!decision.hasMessages) {
    console.warn("Vapi end-of-call report had no artifact.messages; no user turns could be counted", {
      providerCallId: decision.providerCallId,
    });
  }

  const result = await ctx.runMutation(internal.system.voiceDemo.applyCallReport, {
    providerCallId: decision.providerCallId,
    durationSeconds: decision.durationSeconds,
    userTurns: decision.userTurns,
    providerError: decision.providerError,
  });

  if (result.applied) return json(200, { ok: true });
  switch (result.reason) {
    case "already-completed":
      return json(200, { ok: true, duplicate: true });
    case "unknown-call":
      console.warn("Vapi webhook for an unknown call", { providerCallId: decision.providerCallId });
      return json(404, { error: "unknown-call" });
    default:
      console.error("ALERT: Vapi report could not be applied", { reason: result.reason, providerCallId: decision.providerCallId });
      return json(409, { error: result.reason });
  }
});