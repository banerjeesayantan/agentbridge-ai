import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { modules } from "./test.setup";

// Deterministic config and success rule, so these tests check the WIRING of the
// webhook (auth, validation, where the evidence comes from), not real thresholds.
vi.mock("./lib/voiceDemo", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib/voiceDemo")>();
  return {
    ...original,
    readConfig: () => ({
      enabled: true,
      order: ["vapi"],
      maxSessionSeconds: 120,
      reservationTtlSeconds: 600,
      maxAttemptsPerOrg: 5,
      maxFallbacksPerSession: 1,
    }),
    periodKey: () => "2026-10",
    isSuccessfulSession: (i: { userTurns: number; serverElapsedSeconds: number; providerError: boolean }) =>
      !i.providerError && i.userTurns >= 1 && i.serverElapsedSeconds >= 20,
  };
});

const SECRET = "whsec-test-secret-123";
const ASSISTANT = "asst_demo_test";
const CALL = "call_abc-123";

beforeEach(() => {
  vi.stubEnv("VAPI_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("VAPI_DEMO_ASSISTANT_ID", ASSISTANT);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type T = ReturnType<typeof convexTest>;

/** org_A with an ACTIVE demo session bound to CALL, and quota holding its reservation. */
async function seed(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const contactSessionId = await ctx.db.insert("contactSessions", {
      name: "V", email: "v@example.com", organizationId: "org_A", expiresAt: now + 3_600_000,
    });
    for (const provider of ["vapi", "global"]) {
      await ctx.db.insert("voiceQuota", { provider, periodKey: "2026-10", reservedSeconds: 120, usedSeconds: 0 });
    }
    const sessionId = await ctx.db.insert("voiceSessions", {
      organizationId: "org_A",
      contactSessionId,
      provider: "vapi",
      periodKey: "2026-10",
      status: "active",
      reservedSeconds: 120,
      createdAt: now,
      startedAt: now,
      providerCallId: CALL,
      fallbackCount: 0,
      triedProviders: ["vapi"],
      events: [],
    });
    return { sessionId };
  });
}

const report = (message: Record<string, unknown> = {}) => ({
  message: {
    type: "end-of-call-report",
    endedReason: "customer-ended-call",
    durationSeconds: 45,
    call: { id: CALL, assistantId: ASSISTANT },
    artifact: { messages: [{ role: "assistant", message: "Hi" }, { role: "user", message: "Hello" }] },
    ...message,
  },
});

const post = (t: T, body: unknown, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) =>
  t.fetch("/vapi/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const table = (t: T, name: string) => t.run(async (ctx) => (await ctx.db.query(name as never).collect()) as any[]);
const sessionOf = async (t: T, id: unknown) => t.run(async (ctx) => (await ctx.db.get(id as never)) as any);
const quota = async (t: T) =>
  Object.fromEntries((await table(t, "voiceQuota")).map((q) => [q.provider, { r: q.reservedSeconds, u: q.usedSeconds }]));

describe("POST /vapi/webhook: happy path", () => {
  it("applies a genuine report: trial consumed, budget settled from the PROVIDER's duration", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const res = await post(t, report({ durationSeconds: 45 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await table(t, "voiceTrials")).toHaveLength(1);

    const row = await sessionOf(t, s.sessionId);
    expect(row.status).toBe("completed");
    // The server clock saw ~0s; the charge comes from Vapi's 45s, never the browser.
    expect(row.chargedSeconds).toBeGreaterThanOrEqual(45);
    expect(await quota(t)).toEqual({ vapi: { r: 0, u: row.chargedSeconds }, global: { r: 0, u: row.chargedSeconds } });
  });

  it("does not consume the trial for a provider error ending, but still charges the real time", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const res = await post(t, report({ endedReason: "pipeline-error-openai-llm-failed", durationSeconds: 40 }));

    expect(res.status).toBe(200);
    expect(await table(t, "voiceTrials")).toHaveLength(0);
    const row = await sessionOf(t, s.sessionId);
    expect(row.status).toBe("ended_short");
    expect(row.chargedSeconds).toBeGreaterThanOrEqual(40);
  });

  it("does not consume the trial when the user never spoke", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await post(t, report({ artifact: { messages: [{ role: "assistant", message: "Hello?" }] } }));
    expect(await table(t, "voiceTrials")).toHaveLength(0);
  });

  it("falls back to start/end timestamps when durationSeconds is absent", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const res = await post(t, report({ durationSeconds: undefined, startedAt: "2026-10-30T12:00:00Z", endedAt: "2026-10-30T12:00:50Z" }));
    expect(res.status).toBe(200);
    expect((await sessionOf(t, s.sessionId)).chargedSeconds).toBeGreaterThanOrEqual(50);
  });

  it("acknowledges non-report messages without touching anything", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const res = await post(t, { message: { type: "status-update", status: "ended", call: { id: CALL } } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect((await sessionOf(t, s.sessionId)).status).toBe("active");
  });
});

describe("POST /vapi/webhook: authentication", () => {
  it.each([
    ["no Authorization header", {}],
    ["a wrong token", { authorization: "Bearer wrong" }],
    ["the right token without the Bearer scheme", { authorization: SECRET }],
    ["the Basic scheme", { authorization: `Basic ${SECRET}` }],
    ["the legacy X-Vapi-Secret header alone", { "x-vapi-secret": SECRET }],
  ])("rejects %s with 401 and changes nothing", async (_l, headers) => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const res = await post(t, report(), headers);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect((await sessionOf(t, s.sessionId)).status).toBe("active");
    expect(await table(t, "voiceTrials")).toHaveLength(0);
  });

  it("authenticates BEFORE reading the body (garbage + no auth is 401, not 400)", async () => {
    const t = convexTest(schema, modules);
    const res = await post(t, "{not json", {});
    expect(res.status).toBe(401);
  });

  it("never echoes the token or secret in a response or a log line", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const res = await post(t, report(), { authorization: "Bearer attacker-token-xyz" });
    const text = await res.text();
    const logs = JSON.stringify([...(console.warn as any).mock.calls, ...(console.error as any).mock.calls]);
    for (const haystack of [text, logs]) {
      expect(haystack).not.toContain(SECRET);
      expect(haystack).not.toContain("attacker-token-xyz");
    }
  });
});

describe("POST /vapi/webhook: configuration fails closed", () => {
  it.each([
    ["VAPI_WEBHOOK_SECRET", "VAPI_DEMO_ASSISTANT_ID"],
    ["VAPI_DEMO_ASSISTANT_ID", "VAPI_WEBHOOK_SECRET"],
  ])("returns 500 when %s is missing, even with a valid token", async (missing) => {
    const t = convexTest(schema, modules);
    await seed(t);
    vi.stubEnv(missing, "");
    const res = await post(t, report());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "not-configured" });
    expect(await table(t, "voiceTrials")).toHaveLength(0);
  });
});

describe("POST /vapi/webhook: malformed and mismatched reports", () => {
  it("rejects invalid JSON with 400", async () => {
    const t = convexTest(schema, modules);
    expect((await post(t, "{not json")).status).toBe(400);
  });

  it("rejects an oversized body with 413", async () => {
    const t = convexTest(schema, modules);
    const res = await post(t, report({ artifact: { messages: [{ role: "user", message: "x".repeat(1_100_000) }] } }));
    expect(res.status).toBe(413);
  });

  it.each([
    ["a missing call id", { call: { assistantId: ASSISTANT } }, 400],
    ["a malformed call id", { call: { id: "a b/c", assistantId: ASSISTANT } }, 400],
    ["a missing assistant", { call: { id: CALL } }, 400],
    ["a different assistant", { call: { id: CALL, assistantId: "asst_other" } }, 403],
    ["no duration", { durationSeconds: undefined }, 400],
    ["a negative duration", { durationSeconds: -5 }, 400],
  ])("rejects a report with %s and changes nothing", async (_l, message, status) => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const res = await post(t, report(message));
    expect(res.status).toBe(status);
    expect((await sessionOf(t, s.sessionId)).status).toBe("active");
    expect(await table(t, "voiceTrials")).toHaveLength(0);
  });

  it("returns 404 for a call id that matches no session, and creates nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const res = await post(t, report({ call: { id: "call_unknown", assistantId: ASSISTANT } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown-call" });
    expect(await table(t, "voiceTrials")).toHaveLength(0);
  });

  it("returns 409 for a session that cannot accept a report (never started)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) => ctx.db.patch(s.sessionId, { status: "released" }));
    const res = await post(t, report());
    expect(res.status).toBe(409);
    expect(await table(t, "voiceTrials")).toHaveLength(0);
  });

  it("returns 409 when two sessions claim the same call id (never credits either)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const old = await ctx.db.get(s.sessionId);
      const { _id, _creationTime, ...copy } = old as any;
      await ctx.db.insert("voiceSessions", copy);
    });
    const res = await post(t, report());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ambiguous-call" });
    expect(await table(t, "voiceTrials")).toHaveLength(0);
  });
});

describe("POST /vapi/webhook: duplicate deliveries", () => {
  it("a repeated successful report is acknowledged and changes nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await post(t, report());
    const before = await quota(t);

    const second = await post(t, report());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, duplicate: true });
    expect(await table(t, "voiceTrials")).toHaveLength(1);
    expect(await quota(t)).toEqual(before);
  });

  it("repeated non-success reports never charge the same time twice", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const short = report({ durationSeconds: 5, artifact: { messages: [] } });
    await post(t, short);
    const once = { quota: await quota(t), charged: (await sessionOf(t, s.sessionId)).chargedSeconds };
    await post(t, short);
    await post(t, short);

    expect(await quota(t)).toEqual(once.quota);
    expect((await sessionOf(t, s.sessionId)).chargedSeconds).toBe(once.charged);
  });

  it("the browser finishing first, then the report arriving, upgrades without double charging", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const contactSessionId = (await sessionOf(t, s.sessionId)).contactSessionId;
    await t.mutation((await import("./_generated/api")).internal.system.voiceDemo.finish, {
      sessionId: s.sessionId,
      contactSessionId,
      clientDurationSeconds: 999,
      userTurns: 99,
    });
    expect((await sessionOf(t, s.sessionId)).status).toBe("ended_short");

    const res = await post(t, report({ durationSeconds: 45 }));
    expect(res.status).toBe(200);
    const row = await sessionOf(t, s.sessionId);
    expect(row.status).toBe("completed");
    expect(await quota(t)).toEqual({ vapi: { r: 0, u: row.chargedSeconds }, global: { r: 0, u: row.chargedSeconds } });
  });
});