/**
 * Pure validation of a Vapi server message. No database, no environment.
 *
 * Payload shape (Vapi "Server events" docs):
 *   { message: { type: "end-of-call-report", endedReason, call: { id, assistantId, ... },
 *                artifact: { messages: [{ role: "user" | "assistant", message: string }] } } }
 *
 * Everything that decides the trial (duration, user turns, error) is read from
 * what Vapi itself sends. Nothing here comes from the browser.
 */

export type ReportDecision =
  | { kind: "ignore" }
  | { kind: "reject"; status: 400 | 403; error: string }
  | {
      kind: "report";
      providerCallId: string;
      durationSeconds: number;
      userTurns: number;
      providerError: boolean;
      /** False when the payload carried no artifact.messages array (worth a log line). */
      hasMessages: boolean;
    };

/**
 * endedReason values Vapi documents as a normal ending ("Call worked normally,
 * then ended" / assistant actions / customer hang-up). ANYTHING else, including
 * a value we have never seen, counts as a provider error and cannot consume the
 * trial: unknown means fail closed.
 */
export const NORMAL_END_REASONS: ReadonlySet<string> = new Set([
  "customer-ended-call",
  "assistant-ended-call",
  "assistant-ended-call-after-message-spoken",
  "assistant-ended-call-with-hangup-task",
  "assistant-said-end-call-phrase",
  "silence-timed-out",
  "exceeded-max-duration",
]);

const CALL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const MAX_DURATION_SECONDS = 24 * 60 * 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

const isRecord = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const present = (value: unknown) => value !== undefined && value !== null;

const validSeconds = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_DURATION_SECONDS
    ? value
    : null;

/** Provider-reported duration: durationSeconds, else startedAt/endedAt on the message, else on the call. */
function readDuration(message: Obj, call: Obj): number | null | undefined {
  // `undefined` = no usable source at all; `null` = a source was present but invalid.
  if (present(message.durationSeconds)) return validSeconds(message.durationSeconds);

  for (const source of [message, call]) {
    if (present(source.startedAt) && present(source.endedAt)) {
      const start = typeof source.startedAt === "string" ? Date.parse(source.startedAt) : Number.NaN;
      const end = typeof source.endedAt === "string" ? Date.parse(source.endedAt) : Number.NaN;
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      return validSeconds((end - start) / 1000);
    }
  }
  return undefined;
}

export function parseEndOfCallReport(body: unknown, expectedAssistantId: string): ReportDecision {
  if (!isRecord(body) || !isRecord(body.message)) return { kind: "reject", status: 400, error: "malformed" };
  const message = body.message;

  if (typeof message.type !== "string") return { kind: "reject", status: 400, error: "malformed" };
  // Vapi sends many message types to the same URL; only the final report matters here.
  if (message.type !== "end-of-call-report") return { kind: "ignore" };

  const call = message.call;
  if (!isRecord(call)) return { kind: "reject", status: 400, error: "malformed-call" };

  const providerCallId = call.id;
  if (typeof providerCallId !== "string" || !CALL_ID_PATTERN.test(providerCallId)) {
    return { kind: "reject", status: 400, error: "invalid-call-id" };
  }

  // The report must come from OUR demo assistant. Both locations Vapi may use are
  // checked, and a disagreement between them is rejected.
  const fromCall = call.assistantId;
  const fromMessage = isRecord(message.assistant) ? message.assistant.id : undefined;
  const reported = present(fromCall) ? fromCall : fromMessage;
  if (typeof reported !== "string" || !reported) return { kind: "reject", status: 400, error: "missing-assistant" };
  if (present(fromCall) && present(fromMessage) && fromCall !== fromMessage) {
    return { kind: "reject", status: 403, error: "assistant-mismatch" };
  }
  if (reported !== expectedAssistantId) return { kind: "reject", status: 403, error: "assistant-mismatch" };

  const duration = readDuration(message, call);
  if (duration === undefined) return { kind: "reject", status: 400, error: "missing-duration" };
  if (duration === null) return { kind: "reject", status: 400, error: "invalid-duration" };

  const endedReason = present(message.endedReason) ? message.endedReason : call.endedReason;
  const providerError = !(typeof endedReason === "string" && NORMAL_END_REASONS.has(endedReason));

  const messages = isRecord(message.artifact) && Array.isArray(message.artifact.messages) ? message.artifact.messages : null;
  const userTurns = (messages ?? []).filter(
    (m: unknown) => isRecord(m) && m.role === "user" && typeof m.message === "string" && m.message.trim().length > 0,
  ).length;

  return { kind: "report", providerCallId, durationSeconds: duration, userTurns, providerError, hasMessages: messages !== null };
}

/**
 * Constant-time check of an `Authorization: Bearer <token>` header against the
 * configured secret. Both sides are hashed first, so length never leaks.
 */
export async function bearerMatches(header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const match = /^Bearer (\S+)$/.exec(header);
  if (!match || !match[1]) return false;

  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(match[1]), digest(secret)]);

  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 1);
  return diff === 0;
}