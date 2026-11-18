import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  extractBearerToken,
  parseVapiMessage,
  secretsMatch,
} from "./lib/vapiWebhook";

/**
 * POST /vapi/webhook
 *
 * Authenticates Vapi using VAPI_WEBHOOK_SECRET before reading the body.
 *
 * Routes:
 * - Free-demo assistant -> records centrally paid provider expense.
 * - Managed organization assistant -> settles the paid voice call.
 * - Unknown assistant -> rejected.
 *
 * Provider-reported cost and timing data are used for settlement.
 */
const MAX_BODY_BYTES = 1_000_000;

async function readLimitedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

const json = (
  status: number,
  body: Record<string, unknown>,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });

export const vapiWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.VAPI_WEBHOOK_SECRET?.trim();

  if (!secret) {
    console.error(
      "VAPI_WEBHOOK_SECRET is not configured; refusing Vapi webhook.",
    );

    return json(500, { error: "webhook not configured" });
  }

  const token = extractBearerToken(
    request.headers.get("authorization"),
  );

  if (!(await secretsMatch(token, secret))) {
    return json(401, { error: "unauthorized" });
  }

  const raw = await readLimitedBody(request);

  if (raw === null) {
    return json(413, { error: "payload too large" });
  }

  let body: unknown;

  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "invalid json" });
  }

  const parsed = parseVapiMessage(body);

  if (parsed.kind === "ignore") {
    return json(200, { ignored: true });
  }

  if (parsed.kind === "invalid") {
    console.error(
      "Rejected malformed Vapi end-of-call-report",
      { reason: parsed.reason },
    );

    return json(400, { error: "invalid payload" });
  }

  const report = parsed.report;

  // Free-demo calls are paid centrally by AgentBridge.
  // They must not debit a customer's paid voice wallet.
  const demoAssistantId =
    process.env.VAPI_DEMO_ASSISTANT_ID?.trim();

  if (
    demoAssistantId &&
    report.assistantId === demoAssistantId
  ) {
    await ctx.runMutation(
      internal.system.voiceWallet.recordFreeDemoExpense,
      {
        providerCallId: report.providerCallId,
        costMicro: report.costMicro,
      },
    );

    return json(200, {
      ok: true,
      route: "free-demo",
    });
  }

  // Managed organization calls are settled against their
  // previously authorized paid-call reservation.
  const settled = await ctx.runMutation(
    internal.system.voiceWallet.settlePaidCall,
    {
      eventKey: `vapi:end-of-call-report:${report.providerCallId}`,
      providerCallId: report.providerCallId,
      assistantId: report.assistantId,
      costMicro: report.costMicro,
      rawCostUsd: report.rawCostUsd,
      durationSeconds: report.durationSeconds,
      startedAtMs: report.startedAtMs,
      endedAtMs: report.endedAtMs,
      endedReason: report.endedReason,
      overridesDetected: report.overridesDetected,
    },
  );

  if (!settled.ok) {
    if (settled.code === "UNKNOWN_ASSISTANT") {
      console.error(
        "Vapi report for an assistant we do not manage",
        { providerCallId: report.providerCallId },
      );

      return json(403, { error: "unknown assistant" });
    }

    return json(400, { error: "invalid payload" });
  }

  return json(200, {
    ok: true,
    route: "paid",
    outcome: settled.outcome,
  });
});