import { describe, expect, it } from "vitest";
import { bearerMatches, NORMAL_END_REASONS, parseEndOfCallReport } from "./vapiReport";

const ASSISTANT = "asst_demo_test";

/** A valid end-of-call-report body; override pieces of `message` per test. */
const report = (over: Record<string, unknown> = {}) => ({
  message: {
    type: "end-of-call-report",
    endedReason: "customer-ended-call",
    durationSeconds: 45,
    call: { id: "call_abc-123", assistantId: ASSISTANT },
    artifact: {
      messages: [
        { role: "assistant", message: "How can I help?" },
        { role: "user", message: "What can you do?" },
        { role: "assistant", message: "Plenty." },
        { role: "user", message: "Great, thanks." },
      ],
    },
    ...over,
  },
});

const parse = (body: unknown) => parseEndOfCallReport(body, ASSISTANT);

describe("parseEndOfCallReport: a valid report", () => {
  it("extracts call id, provider duration, user turns and a normal ending", () => {
    expect(parse(report())).toEqual({
      kind: "report",
      providerCallId: "call_abc-123",
      durationSeconds: 45,
      userTurns: 2,
      providerError: false,
      hasMessages: true,
    });
  });

  it("derives duration from message startedAt/endedAt when durationSeconds is absent", () => {
    const r = parse(report({ durationSeconds: undefined, startedAt: "2026-10-30T12:00:00.000Z", endedAt: "2026-10-30T12:00:30.500Z" }));
    expect(r).toMatchObject({ kind: "report", durationSeconds: 30.5 });
  });

  it("derives duration from call startedAt/endedAt as a last resort", () => {
    const r = parse(
      report({
        durationSeconds: undefined,
        call: { id: "call_1", assistantId: ASSISTANT, startedAt: "2026-10-30T12:00:00Z", endedAt: "2026-10-30T12:01:00Z" },
      }),
    );
    expect(r).toMatchObject({ kind: "report", durationSeconds: 60 });
  });

  it("accepts the assistant id from message.assistant.id when call.assistantId is absent", () => {
    const r = parse(report({ call: { id: "call_1" }, assistant: { id: ASSISTANT } }));
    expect(r).toMatchObject({ kind: "report", providerCallId: "call_1" });
  });

  it("reads endedReason from the call when the message does not carry it", () => {
    const r = parse(report({ endedReason: undefined, call: { id: "c1", assistantId: ASSISTANT, endedReason: "customer-ended-call" } }));
    expect(r).toMatchObject({ kind: "report", providerError: false });
  });
});

describe("parseEndOfCallReport: user turns come only from provider messages", () => {
  it("does not count assistant lines, blank lines or non-string messages", () => {
    const r = parse(
      report({
        artifact: {
          messages: [
            { role: "assistant", message: "hi" },
            { role: "user", message: "   " },
            { role: "user", message: 42 },
            { role: "user" },
            "garbage",
            null,
            { role: "user", message: "real" },
          ],
        },
      }),
    );
    expect(r).toMatchObject({ kind: "report", userTurns: 1 });
  });

  it("reports zero turns and hasMessages=false when artifact.messages is missing", () => {
    expect(parse(report({ artifact: undefined }))).toMatchObject({ kind: "report", userTurns: 0, hasMessages: false });
    expect(parse(report({ artifact: { messages: "nope" } }))).toMatchObject({ userTurns: 0, hasMessages: false });
  });
});

describe("parseEndOfCallReport: provider errors fail closed", () => {
  it.each([...NORMAL_END_REASONS])("treats %s as a normal ending", (reason) => {
    expect(parse(report({ endedReason: reason }))).toMatchObject({ kind: "report", providerError: false });
  });

  it.each([
    "pipeline-error-openai-llm-failed",
    "call.in-progress.error-vapifault-worker-died",
    "phone-call-provider-closed-websocket",
    "customer-did-not-give-microphone-permission",
    "some-reason-we-have-never-seen",
    "hangup",
    "",
  ])("treats %j as an error (cannot consume the trial)", (reason) => {
    expect(parse(report({ endedReason: reason }))).toMatchObject({ kind: "report", providerError: true });
  });

  it("treats a missing or non-string endedReason as an error", () => {
    expect(parse(report({ endedReason: undefined }))).toMatchObject({ providerError: true });
    expect(parse(report({ endedReason: 7 }))).toMatchObject({ providerError: true });
  });
});

describe("parseEndOfCallReport: rejects", () => {
  it.each([
    ["a non-object body", "string"],
    ["null", null],
    ["an array", []],
    ["a body without message", {}],
    ["a non-object message", { message: "x" }],
    ["a message without a type", { message: {} }],
  ])("%s", (_l, body) => {
    expect(parse(body)).toEqual({ kind: "reject", status: 400, error: "malformed" });
  });

  it("a report without a call object", () => {
    expect(parse(report({ call: undefined }))).toEqual({ kind: "reject", status: 400, error: "malformed-call" });
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["a number", 5],
    ["containing spaces", "call 1"],
    ["containing a slash", "a/b"],
    ["too long", "c".repeat(101)],
  ])("a call id that is %s", (_l, id) => {
    expect(parse(report({ call: { id, assistantId: ASSISTANT } }))).toEqual({ kind: "reject", status: 400, error: "invalid-call-id" });
  });

  it("a report with no assistant id at all", () => {
    expect(parse(report({ call: { id: "c1" } }))).toEqual({ kind: "reject", status: 400, error: "missing-assistant" });
  });

  it("a different assistant", () => {
    expect(parse(report({ call: { id: "c1", assistantId: "asst_other" } }))).toEqual({ kind: "reject", status: 403, error: "assistant-mismatch" });
  });

  it("two assistant ids that disagree, even if one matches", () => {
    const r = parse(report({ call: { id: "c1", assistantId: ASSISTANT }, assistant: { id: "asst_other" } }));
    expect(r).toEqual({ kind: "reject", status: 403, error: "assistant-mismatch" });
  });

  it("a report with no duration source", () => {
    expect(parse(report({ durationSeconds: undefined }))).toEqual({ kind: "reject", status: 400, error: "missing-duration" });
  });

  it.each([
    ["negative", -1],
    ["a string", "45"],
    ["beyond 24 hours", 86_401],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("a durationSeconds that is %s (it never falls back to another source)", (_l, value) => {
    const r = parse(report({ durationSeconds: value, startedAt: "2026-10-30T12:00:00Z", endedAt: "2026-10-30T12:00:45Z" }));
    expect(r).toEqual({ kind: "reject", status: 400, error: "invalid-duration" });
  });

  it("timestamps that are unparseable or run backwards", () => {
    const bad = { durationSeconds: undefined };
    expect(parse(report({ ...bad, startedAt: "x", endedAt: "y" }))).toMatchObject({ error: "invalid-duration" });
    expect(parse(report({ ...bad, startedAt: "2026-10-30T12:01:00Z", endedAt: "2026-10-30T12:00:00Z" }))).toMatchObject({ error: "invalid-duration" });
  });
});

describe("parseEndOfCallReport: other message types", () => {
  it.each(["status-update", "transcript", "conversation-update", "speech-update", "hang", "tool-calls"])(
    "ignores %s",
    (type) => {
      expect(parse({ message: { type, call: { id: "c1" } } })).toEqual({ kind: "ignore" });
    },
  );
});

describe("bearerMatches", () => {
  const SECRET = "s3cret-token-value";

  it("accepts the exact token", async () => {
    expect(await bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    ["no header", null],
    ["empty header", ""],
    ["wrong token", "Bearer nope"],
    ["a prefix of the token", `Bearer ${SECRET.slice(0, -1)}`],
    ["the token plus a suffix", `Bearer ${SECRET}x`],
    ["a different scheme", `Basic ${SECRET}`],
    ["lowercase scheme", `bearer ${SECRET}`],
    ["no scheme", SECRET],
    ["extra whitespace", `Bearer  ${SECRET}`],
    ["a trailing space", `Bearer ${SECRET} `],
    ["an empty token", "Bearer "],
  ])("rejects %s", async (_l, header) => {
    expect(await bearerMatches(header, SECRET)).toBe(false);
  });

  it("rejects everything when no secret is configured", async () => {
    expect(await bearerMatches("Bearer ", "")).toBe(false);
    expect(await bearerMatches("Bearer anything", "")).toBe(false);
  });
});