/**
 * Vapi webhook authentication and end-of-call-report parsing. Pure functions.
 *
 * Authentication: Vapi's Bearer Token credential sends the shared secret as
 * `Authorization: Bearer <token>`. That is authentication only: a shared
 * secret gives no payload integrity and no replay protection, so every event
 * is also validated structurally, matched to a known assistant, and applied
 * idempotently.
 *
 * Payload fields (`message.call.id`, `call.assistantId`, `call.startedAt`,
 * `call.endedAt`, `call.cost` in USD, `call.assistantOverrides`,
 * `message.artifact.messages`) follow Vapi's documented Call object and
 * end-of-call-report example. Their exact placement in a REAL end-of-call
 * delivery is unverified until a sandbox payload is captured; the parser
 * therefore never invents a value: anything missing or malformed stays
 * undefined, and an unknown cost stays pending, never zero.
 */
import { usdToMicro } from "../../../lib/money";

const encoder = new TextEncoder();

export function extractBearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1]!.trim() : null;
}

/** Constant-time secret comparison (compares SHA-256 digests, so lengths never leak). */
export async function secretsMatch(provided: string | null, expected: string | undefined): Promise<boolean> {
  if (!provided || !expected) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export interface ParsedEndOfCall {
  providerCallId: string;
  assistantId: string;
  startedAtMs?: number;
  endedAtMs?: number;
  /** Provider-reported duration, from the call's own start and end timestamps. */
  durationSeconds?: number;
  /** Provider-reported cost, USD, converted once to integer micro-dollars. */
  costMicro?: number;
  rawCostUsd?: number;
  endedReason?: string;
  /** Number of non-empty user messages in the transcript artifact. */
  userTurns: number;
  /** The call carried browser-supplied assistant overrides. */
  overridesDetected: boolean;
}

export type ParseResult =
  | { kind: "ignore" }
  | { kind: "invalid"; reason: string }
  | { kind: "ok"; report: ParsedEndOfCall };

const MAX_ID_LENGTH = 100;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
/** Vapi's documented maximum assistant duration (43,200 s) plus an hour of slack. */
const MAX_PLAUSIBLE_SECONDS = 43_200 + 3_600;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function cleanId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value)
    ? value
    : undefined;
}

function timeMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

export function parseVapiMessage(body: unknown): ParseResult {
  if (!isRecord(body) || !isRecord(body.message)) return { kind: "invalid", reason: "missing message" };
  const message = body.message;
  if (typeof message.type !== "string") return { kind: "invalid", reason: "missing type" };
  if (message.type !== "end-of-call-report") return { kind: "ignore" };

  const call = isRecord(message.call) ? message.call : undefined;
  if (!call) return { kind: "invalid", reason: "missing call" };

  const providerCallId = cleanId(call.id);
  if (!providerCallId) return { kind: "invalid", reason: "invalid call id" };

  const assistant = isRecord(message.assistant) ? message.assistant : undefined;
  const assistantId = cleanId(call.assistantId) ?? cleanId(assistant?.id);
  if (!assistantId) return { kind: "invalid", reason: "invalid assistant id" };

  // Prefer the call object; fall back to message level only when the call has no value.
  const startedAtMs = timeMs(call.startedAt) ?? timeMs(message.startedAt);
  const endedAtMs = timeMs(call.endedAt) ?? timeMs(message.endedAt);

  let durationSeconds: number | undefined;
  if (startedAtMs !== undefined && endedAtMs !== undefined && endedAtMs >= startedAtMs) {
    const seconds = (endedAtMs - startedAtMs) / 1000;
    if (seconds <= MAX_PLAUSIBLE_SECONDS) durationSeconds = seconds;
  }

  const rawCost = typeof call.cost === "number" ? call.cost : message.cost;
  const costMicro = usdToMicro(rawCost) ?? undefined;
  const rawCostUsd = costMicro !== undefined ? (rawCost as number) : undefined;

  const artifact = isRecord(message.artifact) ? message.artifact : undefined;
  let userTurns = 0;
  if (Array.isArray(artifact?.messages)) {
    for (const m of artifact!.messages.slice(0, 5_000)) {
      if (!isRecord(m) || m.role !== "user") continue;
      const text = typeof m.message === "string" ? m.message : typeof m.content === "string" ? m.content : "";
      if (text.trim().length > 0) userTurns++;
    }
  }

  const overrides = call.assistantOverrides;
  const overridesDetected = isRecord(overrides) && Object.keys(overrides).length > 0;

  return {
    kind: "ok",
    report: {
      providerCallId,
      assistantId,
      startedAtMs,
      endedAtMs,
      durationSeconds,
      costMicro,
      rawCostUsd,
      endedReason:
        typeof message.endedReason === "string" && message.endedReason.length <= 100 ? message.endedReason : undefined,
      userTurns,
      overridesDetected,
    },
  };
}

/**
 * Ended reasons treated as a normal end of conversation for the Free-demo
 * trial. Anything else (including an unknown reason) is treated as a provider
 * problem, so the trial is NOT consumed. Override with VAPI_SUCCESS_ENDED_REASONS
 * after checking Vapi's current call-ended-reason list.
 */
export const DEFAULT_SUCCESS_ENDED_REASONS = ["customer-ended-call", "assistant-ended-call", "exceeded-max-duration"];

export function successEndedReasons(env: Record<string, string | undefined>): Set<string> {
  const raw = env.VAPI_SUCCESS_ENDED_REASONS;
  if (raw === undefined || raw.trim() === "") return new Set(DEFAULT_SUCCESS_ENDED_REASONS);
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}
