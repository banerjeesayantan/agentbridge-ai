import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

// Deterministic config and provider choice, so these tests do not depend on the
// real budget settings. DENY_MESSAGES and everything else stay real.
vi.mock("../lib/voiceDemo", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/voiceDemo")>();
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
    // Deterministic success rule, so these tests check WHERE the evidence comes
    // from (the provider's report), not the real thresholds.
    isSuccessfulSession: (i: { userTurns: number; serverElapsedSeconds: number; providerError: boolean }) =>
      !i.providerError && i.userTurns >= 1 && i.serverElapsedSeconds >= 20,
    pickProvider: ({ available, exclude }: { available: Set<string>; exclude: Set<string> }) =>
      [...available].find((p) => !exclude.has(p)) ?? null,
  };
});

beforeEach(() => {
  vi.stubEnv("VAPI_DEMO_PUBLIC_KEY", "pk_test_public");
  vi.stubEnv("VAPI_DEMO_ASSISTANT_ID", "asst_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const HOUR = 60 * 60 * 1000;

type T = ReturnType<typeof convexTest>;

/** An owner and a second, valid visitor in the same org, plus a visitor in another org. */
async function seed(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const contact = (organizationId: string, expiresAt = now + HOUR) =>
      ctx.db.insert("contactSessions", { name: "V", email: "v@example.com", organizationId, expiresAt });

    const owner = await contact("org_A");
    const sameOrgOther = await contact("org_A");
    const otherOrg = await contact("org_B");
    const expiredOwner = await contact("org_A", now - 1000);

    const makeSession = (contactSessionId: typeof owner) =>
      ctx.db.insert("voiceSessions", {
        organizationId: "org_A",
        contactSessionId,
        provider: "vapi",
        periodKey: "2026-10",
        status: "reserved",
        reservedSeconds: 120,
        createdAt: now,
        fallbackCount: 0,
        triedProviders: ["vapi"],
        events: [],
      });

    return {
      owner,
      sameOrgOther,
      otherOrg,
      sessionId: await makeSession(owner),
      expiredSessionId: await makeSession(expiredOwner),
      expiredOwner,
    };
  });
}

const statusOf = (t: T, id: unknown) =>
  t.run(async (ctx) => (await ctx.db.get(id as never) as { status: string } | null)?.status);

describe("voice session ownership", () => {
  it("lets the exact owning contact session control its session", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const r = await t.mutation(internal.system.voiceDemo.markStarted, {
      sessionId: s.sessionId,
      contactSessionId: s.owner,
    });
    expect(r).toHaveProperty("startedAt");
    expect(await statusOf(t, s.sessionId)).toBe("active");
  });

  it("rejects another valid contact session from the SAME organization (markStarted)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await expect(
      t.mutation(internal.system.voiceDemo.markStarted, {
        sessionId: s.sessionId,
        contactSessionId: s.sameOrgOther,
      }),
    ).rejects.toThrow(/SESSION_INVALID/);
    expect(await statusOf(t, s.sessionId)).toBe("reserved");
  });

  it("rejects another contact session from the same organization (finish)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await expect(
      t.mutation(internal.system.voiceDemo.finish, {
        sessionId: s.sessionId,
        contactSessionId: s.sameOrgOther,
        clientDurationSeconds: 60,
        userTurns: 5,
      }),
    ).rejects.toThrow(/SESSION_INVALID/);
    // The reservation was not released or consumed by the intruder.
    expect(await statusOf(t, s.sessionId)).toBe("reserved");
  });

  it("rejects another contact session from the same organization (switchProvider)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await expect(
      t.mutation(internal.system.voiceDemo.switchProvider, {
        sessionId: s.sessionId,
        contactSessionId: s.sameOrgOther,
      }),
    ).rejects.toThrow(/SESSION_INVALID/);
    expect(await statusOf(t, s.sessionId)).toBe("reserved");
  });

  it("still rejects a contact session from a different organization", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await expect(
      t.mutation(internal.system.voiceDemo.markStarted, {
        sessionId: s.sessionId,
        contactSessionId: s.otherOrg,
      }),
    ).rejects.toThrow(/SESSION_INVALID/);
  });

  it("still rejects an expired owning contact session", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await expect(
      t.mutation(internal.system.voiceDemo.markStarted, {
        sessionId: s.expiredSessionId,
        contactSessionId: s.expiredOwner,
      }),
    ).rejects.toThrow(/SESSION_INVALID/);
  });
});

describe("reservation takeover", () => {
  /** org_A with one unstarted reservation held by `owner`, with matching quota rows. */
  async function reserved(t: T) {
    const s = await seed(t);
    await t.run(async (ctx) => {
      for (const provider of ["vapi", "global"]) {
        await ctx.db.insert("voiceQuota", { provider, periodKey: "2026-10", reservedSeconds: 120, usedSeconds: 0 });
      }
    });
    return s;
  }

  const owner = (t: T, id: unknown) =>
    t.run(async (ctx) => (await ctx.db.get(id as never) as { contactSessionId: unknown } | null)?.contactSessionId);

  const reservedSeconds = (t: T) =>
    t.run(async (ctx) =>
      Object.fromEntries((await ctx.db.query("voiceQuota").collect()).map((q) => [q.provider, q.reservedSeconds])),
    );

  it("gives the SAME visitor the same reservation on retry or refresh", async () => {
    const t = convexTest(schema, modules);
    const s = await reserved(t);
    const r = await t.mutation(internal.system.voiceDemo.reserve, {
      organizationId: "org_A",
      contactSessionId: s.owner,
    });
    expect(r.sessionId).toBe(s.sessionId);
    expect(await owner(t, s.sessionId)).toBe(s.owner);
    expect(await reservedSeconds(t)).toEqual({ vapi: 120, global: 120 });
  });

  it("does NOT hand a live visitor's reservation to another visitor in the same organization", async () => {
    const t = convexTest(schema, modules);
    const s = await reserved(t);

    await expect(
      t.mutation(internal.system.voiceDemo.reserve, {
        organizationId: "org_A",
        contactSessionId: s.sameOrgOther,
      }),
    ).rejects.toThrow(/IN_PROGRESS/);

    // Ownership is unchanged, and the real owner can still use it.
    expect(await owner(t, s.sessionId)).toBe(s.owner);
    const started = await t.mutation(internal.system.voiceDemo.markStarted, {
      sessionId: s.sessionId,
      contactSessionId: s.owner,
    });
    expect(started).toHaveProperty("startedAt");
  });

  it("releases an orphaned reservation whose owner has expired, and gives the new visitor their own", async () => {
    const t = convexTest(schema, modules);
    const s = await reserved(t);
    // Make the original owner's contact session expire.
    await t.run((ctx) => ctx.db.patch(s.owner, { expiresAt: Date.now() - 1000 }));

    const r = await t.mutation(internal.system.voiceDemo.reserve, {
      organizationId: "org_A",
      contactSessionId: s.sameOrgOther,
    });

    // A NEW reservation, bound to the new visitor; the old one is released, not re-bound.
    expect(r.sessionId).not.toBe(s.sessionId);
    expect(await owner(t, r.sessionId)).toBe(s.sameOrgOther);
    const old = await t.run((ctx) => ctx.db.get(s.sessionId));
    expect(old).toMatchObject({ status: "released", contactSessionId: s.owner, chargedSeconds: 0 });
    // Budget: old 120 released, new 120 reserved => net 120, never 240.
    expect(await reservedSeconds(t)).toEqual({ vapi: 120, global: 120 });
  });

  it("still refuses a second visitor while a call is active", async () => {
    const t = convexTest(schema, modules);
    const s = await reserved(t);
    await t.mutation(internal.system.voiceDemo.markStarted, {
      sessionId: s.sessionId,
      contactSessionId: s.owner,
    });
    await expect(
      t.mutation(internal.system.voiceDemo.reserve, {
        organizationId: "org_A",
        contactSessionId: s.sameOrgOther,
      }),
    ).rejects.toThrow(/IN_PROGRESS/);
    expect(await owner(t, s.sessionId)).toBe(s.owner);
  });
});

describe("trial is decided by the provider's report, never by the browser", () => {
  const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const report = (over: Partial<{ providerCallId: string; durationSeconds: number; userTurns: number; providerError: boolean }> = {}) => ({
    providerCallId: "call_1",
    durationSeconds: 45,
    userTurns: 3,
    providerError: false,
    ...over,
  });

  /** org_A, owner's session reserved with quota held, then started with call_1. */
  async function started(t: T) {
    const s = await seed(t);
    await t.run(async (ctx) => {
      for (const provider of ["vapi", "global"]) {
        await ctx.db.insert("voiceQuota", { provider, periodKey: "2026-10", reservedSeconds: 120, usedSeconds: 0 });
      }
    });
    await t.mutation(internal.system.voiceDemo.markStarted, {
      sessionId: s.sessionId,
      contactSessionId: s.owner,
      providerCallId: "call_1",
    });
    return s;
  }

  const trials = (t: T) => t.run((ctx) => ctx.db.query("voiceTrials").collect());
  const session = (t: T, id: unknown) =>
    t.run(async (ctx) => (await ctx.db.get(id as never)) as { status: string; chargedSeconds?: number } | null);
  const quota = (t: T) =>
    t.run(async (ctx) =>
      Object.fromEntries((await ctx.db.query("voiceQuota").collect()).map((q) => [q.provider, { r: q.reservedSeconds, u: q.usedSeconds }])),
    );

  it("finish() cannot consume the trial with forged duration and turns", async () => {
    const t = convexTest(schema, modules);
    const s = await started(t);
    vi.setSystemTime(T0 + 60_000);

    const r = await t.mutation(internal.system.voiceDemo.finish, {
      sessionId: s.sessionId,
      contactSessionId: s.owner,
      clientDurationSeconds: 600,
      userTurns: 99,
    });

    expect(r).toEqual({ outcome: "ended_short", trialConsumed: false });
    expect(await trials(t)).toHaveLength(0);
    expect((await session(t, s.sessionId))?.status).toBe("ended_short");
  });

  it("finish() charges only server-measured time and releases the reservation", async () => {
    const t = convexTest(schema, modules);
    const s = await started(t);
    vi.setSystemTime(T0 + 30_000);
    await t.mutation(internal.system.voiceDemo.finish, {
      sessionId: s.sessionId,
      contactSessionId: s.owner,
      clientDurationSeconds: 1,
      userTurns: 0,
    });
    const charged = (await session(t, s.sessionId))?.chargedSeconds ?? 0;
    expect(charged).toBeGreaterThan(0);
    expect(await quota(t)).toEqual({ vapi: { r: 0, u: charged }, global: { r: 0, u: charged } });
  });

  it("a genuine provider report consumes the trial and settles the budget", async () => {
    const t = convexTest(schema, modules);
    const s = await started(t);
    const r = await t.mutation(internal.system.voiceDemo.applyCallReport, report());

    expect(r).toEqual({ applied: true, outcome: "completed", trialConsumed: true });
    expect(await trials(t)).toHaveLength(1);
    const row = await session(t, s.sessionId);
    expect(row?.status).toBe("completed");
    expect(await quota(t)).toEqual({
      vapi: { r: 0, u: row?.chargedSeconds },
      global: { r: 0, u: row?.chargedSeconds },
    });
  });

  it.each([
    ["too short with no user speech", { durationSeconds: 5, userTurns: 0 }],
    ["provider error", { providerError: true }],
    ["negative duration and NaN turns", { durationSeconds: -5, userTurns: Number.NaN }],
  ])("a report that is %s does not consume the trial", async (_label, over) => {
    const t = convexTest(schema, modules);
    const s = await started(t);
    const r = await t.mutation(internal.system.voiceDemo.applyCallReport, report(over));

    expect(r).toMatchObject({ applied: true, outcome: "ended_short", trialConsumed: false });
    expect(await trials(t)).toHaveLength(0);
    expect((await session(t, s.sessionId))?.status).toBe("ended_short");
  });

  it("ignores a report for an unknown call", async () => {
    const t = convexTest(schema, modules);
    await started(t);
    const r = await t.mutation(internal.system.voiceDemo.applyCallReport, report({ providerCallId: "call_other" }));
    expect(r).toEqual({ applied: false, reason: "unknown-call" });
    expect(await trials(t)).toHaveLength(0);
  });

  it("a report that arrives before finish() makes finish() report the trial as consumed", async () => {
    const t = convexTest(schema, modules);
    const s = await started(t);
    await t.mutation(internal.system.voiceDemo.applyCallReport, report());

    const r = await t.mutation(internal.system.voiceDemo.finish, {
      sessionId: s.sessionId,
      contactSessionId: s.owner,
      clientDurationSeconds: 0,
      userTurns: 0,
    });
    expect(r).toEqual({ outcome: "completed", trialConsumed: true });
    expect(await trials(t)).toHaveLength(1);
  });

  it("a report that arrives after finish() upgrades the session and charges only the difference", async () => {
    const t = convexTest(schema, modules);
    const s = await started(t);
    vi.setSystemTime(T0 + 10_000);
    await t.mutation(internal.system.voiceDemo.finish, {
      sessionId: s.sessionId,
      contactSessionId: s.owner,
      clientDurationSeconds: 1,
      userTurns: 0,
    });
    const first = (await session(t, s.sessionId))?.chargedSeconds ?? 0;

    const r = await t.mutation(internal.system.voiceDemo.applyCallReport, report({ durationSeconds: 45 }));
    expect(r).toEqual({ applied: true, outcome: "completed", trialConsumed: true });

    const row = await session(t, s.sessionId);
    expect(row?.status).toBe("completed");
    expect(row?.chargedSeconds ?? 0).toBeGreaterThan(first);
    // Budget total equals the session's final charge: the first charge is not counted twice.
    expect(await quota(t)).toEqual({
      vapi: { r: 0, u: row?.chargedSeconds },
      global: { r: 0, u: row?.chargedSeconds },
    });
  });

  it("a repeated report is idempotent: one trial, no extra charge", async () => {
    const t = convexTest(schema, modules);
    await started(t);
    await t.mutation(internal.system.voiceDemo.applyCallReport, report());
    const before = await quota(t);
    const again = await t.mutation(internal.system.voiceDemo.applyCallReport, report());

    expect(again).toEqual({ applied: false, reason: "already-completed" });
    expect(await trials(t)).toHaveLength(1);
    expect(await quota(t)).toEqual(before);
  });

  it("one provider call cannot be credited to two sessions", async () => {
    const t = convexTest(schema, modules);
    const s = await started(t); // owner's session now holds call_1
    const second = await t.run((ctx) =>
      ctx.db.insert("voiceSessions", {
        organizationId: "org_A",
        contactSessionId: s.sameOrgOther,
        provider: "vapi",
        periodKey: "2026-10",
        status: "reserved",
        reservedSeconds: 120,
        createdAt: Date.now(),
        fallbackCount: 0,
        triedProviders: ["vapi"],
        events: [],
      }),
    );

    await expect(
      t.mutation(internal.system.voiceDemo.markStarted, {
        sessionId: second,
        contactSessionId: s.sameOrgOther,
        providerCallId: "call_1",
      }),
    ).rejects.toThrow(/SESSION_INVALID/);
    expect((await session(t, second))?.status).toBe("reserved");
  });
});