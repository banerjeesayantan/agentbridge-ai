import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../../_generated/api";
import {
  assertLedgerInvariants,
  DAY,
  newT,
  seed,
  stubVoiceEnv,
  walletFor,
  type T,
} from "../../../finance.testkit";

const RESERVE = 2_500_000; // 600 s at 250_000 micro-dollars/minute

beforeEach(() => {
  stubVoiceEnv();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const reserve = (t: T, contactSessionId: unknown) =>
  t.mutation(internal.features.voice.internal.voiceWallet.reserveCall, {
    contactSessionId: contactSessionId as never,
  });

const bind = (
  t: T,
  reservationId: unknown,
  providerCallId = "call_1",
  assistantId = "asst_A",
) =>
  t.mutation(internal.features.voice.internal.voiceWallet.bindCall, {
    reservationId: reservationId as never,
    providerCallId,
    assistantId,
  });

const settle = (t: T, over: Record<string, unknown> = {}) =>
  t.mutation(internal.features.voice.internal.voiceWallet.settlePaidCall, {
    eventKey: "vapi:end-of-call-report:call_1",
    providerCallId: "call_1",
    assistantId: "asst_A",
    costMicro: 1_000_000,
    rawCostUsd: 1,
    durationSeconds: 90,
    overridesDetected: false,
    ...over,
  } as never);

const openOk = async (t: T, session: unknown) => {
  const r = await reserve(t, session);
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r;
};

describe("authorization and isolation", () => {
  it("holds budget for one call and returns the SERVER-mapped assistant", async () => {
    const t = newT();
    const s = await seed(t);
    const r = await openOk(t, s.A1);
    expect(r).toMatchObject({
      reused: false,
      assistantId: "asst_A",
      reservedMicro: RESERVE,
      maxCallSeconds: 600,
    });

    const w = await walletFor(t, "org_A");
    expect(w).toMatchObject({
      budgetMicro: 14_750_000,
      reservedMicro: RESERVE,
      spentMicro: 0,
    });
    await assertLedgerInvariants(t);
  });

  it("never lets one organization touch another's wallet or assistant", async () => {
    const t = newT();
    const s = await seed(t);
    const a = await openOk(t, s.A1);
    const b = await openOk(t, s.B1);
    await bind(t, b.reservationId, "call_B", "asst_B");
    expect(a.assistantId).toBe("asst_A");
    expect(b.assistantId).toBe("asst_B");

    expect(await walletFor(t, "org_A")).toMatchObject({
      budgetMicro: 14_750_000,
      reservedMicro: RESERVE,
    });
    expect(await walletFor(t, "org_B")).toMatchObject({
      budgetMicro: 49_750_000,
      reservedMicro: RESERVE,
    });

    // org B's webhook cannot settle org A's reservation: attribution follows the assistant mapping.
    await settle(t, {
      assistantId: "asst_B",
      providerCallId: "call_B",
      eventKey: "k_B",
      costMicro: 700_000,
    });
    expect(await walletFor(t, "org_A")).toMatchObject({
      reservedMicro: RESERVE,
      spentMicro: 0,
    });
    expect(await walletFor(t, "org_B")).toMatchObject({
      reservedMicro: 0,
      spentMicro: 700_000,
    });
    await assertLedgerInvariants(t);
  });

  it.each([
    ["a Free organization", "F1", "PLAN_REQUIRED"],
    ["an expired visitor session", "A_expired", "SESSION_INVALID"],
  ])("denies %s", async (_label, who, code) => {
    const t = newT();
    const s = (await seed(t)) as Record<string, unknown>;
    expect(await reserve(t, s[who])).toEqual({ ok: false, code });
    expect(
      await t.run((ctx) => ctx.db.query("voiceWallets").collect()),
    ).toHaveLength(0);
  });

  it("denies when the organization has no managed assistant", async () => {
    const t = newT();
    const s = await seed(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("managedAssistants")
        .withIndex("by_organization_id", (q) => q.eq("organizationId", "org_A"))
        .first();
      await ctx.db.delete(row!._id);
    });
    expect(await reserve(t, s.A1)).toEqual({ ok: false, code: "NO_ASSISTANT" });
  });

  it("denies a suspended organization and a paused provider, and resumes when cleared", async () => {
    const t = newT();
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgVoiceControls", {
        organizationId: "org_A",
        suspended: true,
        updatedAt: 1,
        updatedBy: "u",
      });
    });
    expect(await reserve(t, s.A1)).toEqual({
      ok: false,
      code: "ORG_SUSPENDED",
    });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("orgVoiceControls").first();
      await ctx.db.patch(row!._id, { suspended: false });
      await ctx.db.insert("providerAccount", {
        key: "central",
        paused: true,
        updatedAt: 1,
        updatedBy: "u",
      });
    });
    expect(await reserve(t, s.A1)).toEqual({
      ok: false,
      code: "PROVIDER_PAUSED",
    });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("providerAccount").first();
      await ctx.db.patch(row!._id, { paused: false });
    });
    expect((await reserve(t, s.A1)).ok).toBe(true);
  });

  it("fails closed when the required voice configuration is missing", async () => {
    vi.unstubAllEnvs();
    const t = newT();
    const s = await seed(t);
    expect(await reserve(t, s.A1)).toEqual({
      ok: false,
      code: "VOICE_UNAVAILABLE",
    });
  });

  it("denies a plan whose configured budget is zero", async () => {
    stubVoiceEnv({ VOICE_BUDGET_PRO_MICRO: "0" });
    const t = newT();
    const s = await seed(t);
    expect(await reserve(t, s.A1)).toEqual({
      ok: false,
      code: "VOICE_UNAVAILABLE",
    });
  });
});

describe("atomic reservations and concurrency", () => {
  it("allows one open call per organization by default", async () => {
    const t = newT();
    const s = await seed(t);
    await openOk(t, s.A1);
    expect(await reserve(t, s.A2)).toEqual({ ok: false, code: "IN_PROGRESS" });
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(RESERVE); // the denial held nothing
  });

  it("gives the SAME visitor the same reservation and the same expiry, and holds nothing extra", async () => {
    const t = newT();
    const s = await seed(t);
    const first = await openOk(t, s.A1);
    const again = await openOk(t, s.A1);
    expect(again.reused).toBe(true);
    expect(again.reservationId).toBe(first.reservationId);
    expect(again.tokenExpiresAt).toBe(first.tokenExpiresAt);
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(RESERVE);
    await assertLedgerInvariants(t);
  });

  it("two simultaneous requests can never overspend the budget", async () => {
    // Budget fits exactly one hold; concurrency would otherwise allow two.
    stubVoiceEnv({
      VOICE_BUDGET_PRO_MICRO: "3000000",
      VOICE_MAX_CONCURRENT_PER_ORG: "5",
    });
    const t = newT();
    const s = await seed(t);
    const results = await Promise.all([reserve(t, s.A1), reserve(t, s.A2)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok).map((r) => (r as { code: string }).code),
    ).toEqual(["NO_BUDGET"]);
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(RESERVE);
    await assertLedgerInvariants(t);
  });

  it("denies NO_BUDGET once spending plus holds reach the budget", async () => {
    stubVoiceEnv({
      VOICE_BUDGET_PRO_MICRO: "3000000",
      VOICE_MAX_CONCURRENT_PER_ORG: "5",
    });
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);
    await settle(t, { costMicro: 2_000_000 }); // spent 2_000_000 of 3_000_000
    expect(await reserve(t, s.A2)).toEqual({ ok: false, code: "NO_BUDGET" }); // 1_000_000 left < 2_500_000
  });

  it("limits how many authorizations one visitor session can make", async () => {
    stubVoiceEnv({ VOICE_MAX_AUTHORIZATIONS_PER_SESSION: "1" });
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);
    await settle(t);
    expect(await reserve(t, s.A1)).toEqual({
      ok: false,
      code: "SESSION_LIMIT",
    });
  });
});

describe("settlement: actual provider cost, never reservations, never zero for unknown", () => {
  it("settles a known cost: releases the hold, debits the wallet, records charge and expense", async () => {
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);
    expect(await settle(t, { costMicro: 1_234_567 })).toEqual({
      ok: true,
      outcome: "settled",
    });

    expect(await walletFor(t, "org_A")).toMatchObject({
      reservedMicro: 0,
      spentMicro: 1_234_567,
    });
    const rows = await t.run(async (ctx) => ({
      usage: await ctx.db.query("voiceUsage").collect(),
      expenses: await ctx.db.query("providerExpenses").collect(),
      reservation: await ctx.db.get(res.reservationId),
    }));
    expect(rows.usage[0]).toMatchObject({
      organizationId: "org_A",
      costStatus: "known",
      costMicro: 1_234_567,
      customerChargeMicro: 1_234_567,
      unreserved: false,
    });
    expect(rows.expenses[0]).toMatchObject({
      kind: "paid_call",
      organizationId: "org_A",
      costStatus: "known",
      costMicro: 1_234_567,
    });
    expect(rows.reservation).toMatchObject({
      status: "settled",
      providerCallId: "call_1",
    });
    await assertLedgerInvariants(t);
  });

  it("records the ACTUAL cost even when it exceeds the reservation, then blocks further calls", async () => {
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);
    await settle(t, { costMicro: 20_000_000 }); // far above the 2_500_000 hold and the 14_750_000 budget

    const alerts = await t.run(async (ctx) =>
      ctx.db.query("voiceCostAlerts").collect(),
    );

    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => alert.alertType).sort()).toEqual([
      "BUDGET_EXCEEDED",
      "RESERVATION_OVERRUN",
    ]);

    // Duplicate provider delivery must not create additional alerts or debit again.
    expect(await settle(t, { costMicro: 20_000_000 })).toMatchObject({
      ok: true,
      outcome: "duplicate",
    });

    const alertsAfterDuplicate = await t.run(async (ctx) =>
      ctx.db.query("voiceCostAlerts").collect(),
    );
    expect(alertsAfterDuplicate).toHaveLength(2);

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: "org_A",
          alertType: "RESERVATION_OVERRUN",
          reservedMicro: RESERVE,
          actualCostMicro: 20_000_000,
          budgetMicro: 14_750_000,
          resultingSpentMicro: 20_000_000,
        }),
        expect.objectContaining({
          organizationId: "org_A",
          alertType: "BUDGET_EXCEEDED",
          reservedMicro: RESERVE,
          actualCostMicro: 20_000_000,
          budgetMicro: 14_750_000,
          resultingSpentMicro: 20_000_000,
        }),
      ]),
    );
    expect(await walletFor(t, "org_A")).toMatchObject({
      reservedMicro: 0,
      spentMicro: 20_000_000,
      budgetMicro: 14_750_000,
    });
    expect(await reserve(t, s.A1)).toEqual({ ok: false, code: "NO_BUDGET" });
    await assertLedgerInvariants(t);
  });

  it("an unknown cost stays PENDING, keeps the hold, and is never recorded as zero", async () => {
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);
    expect(
      await settle(t, { costMicro: undefined, rawCostUsd: undefined }),
    ).toEqual({ ok: true, outcome: "pending_cost" });

    expect(await walletFor(t, "org_A")).toMatchObject({
      reservedMicro: RESERVE,
      spentMicro: 0,
    }); // conservative hold kept
    const rows = await t.run(async (ctx) => ({
      usage: await ctx.db.query("voiceUsage").first(),
      expense: await ctx.db.query("providerExpenses").first(),
      reservation: await ctx.db.get(res.reservationId),
    }));
    expect(rows.usage).toMatchObject({ costStatus: "pending" });
    expect(rows.usage!.costMicro).toBeUndefined();
    expect(rows.usage!.customerChargeMicro).toBeUndefined();
    expect(rows.expense).toMatchObject({ costStatus: "pending" });
    expect(rows.expense!.costMicro).toBeUndefined();
    expect(rows.reservation!.status).toBe("pending_cost");
    await assertLedgerInvariants(t);
  });

  it("creates durable overrun alerts when late reconciliation reveals an excessive provider cost", async () => {
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);

    expect(
      await settle(t, { costMicro: undefined, rawCostUsd: undefined }),
    ).toEqual({ ok: true, outcome: "pending_cost" });

    expect(
      await t.run(async (ctx) =>
        ctx.db.query("voiceCostAlerts").collect(),
      ),
    ).toHaveLength(0);

    const reconciled = await t.mutation(
      internal.features.voice.internal.voiceWallet.recordActualCost,
      { providerCallId: "call_1", costMicro: 20_000_000 },
    );
    expect(reconciled).toEqual({ ok: true, outcome: "settled" });

    const alerts = await t.run(async (ctx) =>
      ctx.db.query("voiceCostAlerts").collect(),
    );

    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => alert.alertType).sort()).toEqual([
      "BUDGET_EXCEEDED",
      "RESERVATION_OVERRUN",
    ]);
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: "org_A",
          providerCallId: "call_1",
          alertType: "RESERVATION_OVERRUN",
          reservedMicro: RESERVE,
          actualCostMicro: 20_000_000,
          budgetMicro: 14_750_000,
          resultingSpentMicro: 20_000_000,
        }),
        expect.objectContaining({
          organizationId: "org_A",
          providerCallId: "call_1",
          alertType: "BUDGET_EXCEEDED",
          reservedMicro: RESERVE,
          actualCostMicro: 20_000_000,
          budgetMicro: 14_750_000,
          resultingSpentMicro: 20_000_000,
        }),
      ]),
    );

    expect(
      await t.mutation(
        internal.features.voice.internal.voiceWallet.recordActualCost,
        { providerCallId: "call_1", costMicro: 20_000_000 },
      ),
    ).toEqual({ ok: true, outcome: "duplicate" });

    expect(
      await t.run(async (ctx) =>
        ctx.db.query("voiceCostAlerts").collect(),
      ),
    ).toHaveLength(2);

    expect(await walletFor(t, "org_A")).toMatchObject({
      reservedMicro: 0,
      spentMicro: 20_000_000,
      budgetMicro: 14_750_000,
    });

    await assertLedgerInvariants(t);
  });
  it("reconciliation supplies the real cost: hold released, spend recorded once, repeatable safely", async () => {
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);
    await settle(t, { costMicro: undefined, rawCostUsd: undefined });

    const first = await t.mutation(
      internal.features.voice.internal.voiceWallet.recordActualCost,
      { providerCallId: "call_1", costMicro: 800_000 },
    );
    expect(first).toEqual({ ok: true, outcome: "settled" });
    const second = await t.mutation(
      internal.features.voice.internal.voiceWallet.recordActualCost,
      { providerCallId: "call_1", costMicro: 800_000 },
    );
    expect(second).toEqual({ ok: true, outcome: "duplicate" });

    expect(await walletFor(t, "org_A")).toMatchObject({
      reservedMicro: 0,
      spentMicro: 800_000,
    });
    const exp = await t.run((ctx) => ctx.db.query("providerExpenses").first());
    expect(exp).toMatchObject({ costStatus: "known", costMicro: 800_000 });
    await assertLedgerInvariants(t);
  });

  it("automatically reconciles a late cost delivered with the original event key", async () => {
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);

    const pending = await settle(t, {
      costMicro: undefined,
      rawCostUsd: undefined,
    });
    expect(pending).toEqual({ ok: true, outcome: "pending_cost" });

    const reconciled = await settle(t, {
      costMicro: 800_000,
      rawCostUsd: 0.8,
    });
    expect(reconciled).toEqual({ ok: true, outcome: "settled" });

    // Same event key is now a duplicate, with no second debit.
    expect(await settle(t, {
      costMicro: 800_000,
      rawCostUsd: 0.8,
    })).toEqual({ ok: true, outcome: "duplicate" });

    expect(
      await t.run(async (ctx) =>
        ctx.db.query("voiceCostAlerts").collect(),
      ),
    ).toHaveLength(0);

    expect(await walletFor(t, "org_A")).toMatchObject({
      reservedMicro: 0,
      spentMicro: 800_000,
    });

    const rows = await t.run(async (ctx) => ({
      usage: await ctx.db.query("voiceUsage").first(),
      expense: await ctx.db.query("providerExpenses").first(),
      reservation: await ctx.db.get(res.reservationId),
    }));

    expect(rows.usage).toMatchObject({
      costStatus: "known",
      costMicro: 800_000,
      customerChargeMicro: 800_000,
    });
    expect(rows.expense).toMatchObject({
      costStatus: "known",
      costMicro: 800_000,
    });
    expect(rows.reservation).toMatchObject({ status: "settled" });

    await assertLedgerInvariants(t);
  });

  it("automatically reconciles a late cost delivered with a different event key", async () => {
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);

    const pending = await settle(t, {
      costMicro: undefined,
      rawCostUsd: undefined,
    });
    expect(pending).toEqual({ ok: true, outcome: "pending_cost" });

    const reconciled = await settle(t, {
      eventKey: "vapi:late-cost:call_1",
      costMicro: 1_200_000,
      rawCostUsd: 1.2,
    });
    expect(reconciled).toEqual({ ok: true, outcome: "settled" });

    // Redelivery under the late event key must not charge again.
    expect(await settle(t, {
      eventKey: "vapi:late-cost:call_1",
      costMicro: 1_200_000,
      rawCostUsd: 1.2,
    })).toEqual({ ok: true, outcome: "duplicate" });

    expect(
      await t.run(async (ctx) =>
        ctx.db.query("voiceCostAlerts").collect(),
      ),
    ).toHaveLength(0);

    expect(await walletFor(t, "org_A")).toMatchObject({
      reservedMicro: 0,
      spentMicro: 1_200_000,
    });

    const rows = await t.run(async (ctx) => ({
      usage: await ctx.db.query("voiceUsage").first(),
      expense: await ctx.db.query("providerExpenses").first(),
      reservation: await ctx.db.get(res.reservationId),
    }));

    expect(rows.usage).toMatchObject({
      costStatus: "known",
      costMicro: 1_200_000,
      customerChargeMicro: 1_200_000,
    });
    expect(rows.expense).toMatchObject({
      costStatus: "known",
      costMicro: 1_200_000,
    });
    expect(rows.reservation).toMatchObject({ status: "settled" });

    await assertLedgerInvariants(t);
  });
  it("rejects reconciliation for an unknown call or an invalid amount", async () => {
    const t = newT();
    await seed(t);
    expect(
      await t.mutation(internal.features.voice.internal.voiceWallet.recordActualCost, {
        providerCallId: "nope",
        costMicro: 1,
      }),
    ).toEqual({ ok: false, code: "UNKNOWN_CALL" });
    expect(
      await t.mutation(internal.features.voice.internal.voiceWallet.recordActualCost, {
        providerCallId: "nope",
        costMicro: -1,
      }),
    ).toEqual({ ok: false, code: "INVALID" });
    expect(
      await t.mutation(internal.features.voice.internal.voiceWallet.recordActualCost, {
        providerCallId: "nope",
        costMicro: 1.5,
      }),
    ).toEqual({ ok: false, code: "INVALID" });
  });

  it("a duplicate delivery (same call) can never charge twice", async () => {
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);
    await settle(t, { costMicro: 1_000_000 });
    expect(await settle(t, { costMicro: 1_000_000 })).toEqual({
      ok: true,
      outcome: "duplicate",
    });
    // A redelivery under a different event key is still the same provider call.
    expect(
      await settle(t, { costMicro: 9_000_000, eventKey: "other-key" }),
    ).toEqual({ ok: true, outcome: "duplicate" });
    expect(await walletFor(t, "org_A")).toMatchObject({
      spentMicro: 1_000_000,
      reservedMicro: 0,
    });
    expect(
      await t.run((ctx) => ctx.db.query("voiceUsage").collect()),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("providerExpenses").collect()),
    ).toHaveLength(1);
    await assertLedgerInvariants(t);
  });

  it("rejects a report for an assistant we do not manage, recording nothing", async () => {
    const t = newT();
    const s = await seed(t);
    await openOk(t, s.A1);
    expect(await settle(t, { assistantId: "asst_stranger" })).toEqual({
      ok: false,
      code: "UNKNOWN_ASSISTANT",
    });
    expect(
      await t.run((ctx) => ctx.db.query("voiceUsage").collect()),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query("processedProviderEvents").collect()),
    ).toHaveLength(0);
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(RESERVE);
  });

  it("rejects an invalid cost amount", async () => {
    const t = newT();
    await seed(t);
    for (const costMicro of [-1, 1.5, Number.NaN]) {
      expect(await settle(t, { costMicro })).toEqual({
        ok: false,
        code: "INVALID",
      });
    }
  });

  it("does not debit a tenant for a provider report without a verified reservation binding", async () => {
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);
    await settle(t, { costMicro: 500_000 });

    expect(
      await settle(t, {
        providerCallId: "call_2",
        eventKey: "k2",
        costMicro: 300_000,
      }),
    ).toEqual({ ok: true, outcome: "pending_binding" });

    const usage = await t.run((ctx) => ctx.db.query("voiceUsage").collect());
    expect(usage.find((u) => u.providerCallId === "call_2")).toBeUndefined();
    expect(await walletFor(t, "org_A")).toMatchObject({
      spentMicro: 500_000,
      reservedMicro: 0,
    });
    const parked = await t.run((ctx) => ctx.db.query("unboundVoiceReports").collect());
    expect(parked.find((r) => r.providerCallId === "call_2")).toMatchObject({
      status: "pending",
      organizationId: "org_A",
    });
    await assertLedgerInvariants(t);
  });

    it("settles a stale pending report when its reservation was subsequently bound", async () => {
    const T0 = Date.UTC(2026, 10, 17, 12, 0, 0);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);

    const t = newT();
    const s = await seed(t, T0);
    const res = await openOk(t, s.A1);

    // The provider report arrives before the reservation is bound.
    expect(
      await settle(t, {
        providerCallId: "call_1",
        eventKey: "pending:call_1",
        costMicro: 300_000,
      }),
    ).toEqual({ ok: true, outcome: "pending_binding" });

    // Age the report beyond the 15-minute reconciliation grace period.
    // The reservation hold remains valid at this point.
    vi.setSystemTime(T0 + 16 * 60 * 1000);

    // Bind the exact provider call, without settling the pending report.
    await bind(t, res.reservationId, "call_1", "asst_A");

    const result = await t.mutation(
      internal.features.voice.internal.voiceWallet.reconcileUnboundReports,
      {},
    );

    expect(result).toEqual({
      unmatched: 0,
      settled: 1,
      deferred: 0,
    });

    // The tenant must be charged exactly once.
    expect(await walletFor(t, "org_A")).toMatchObject({
      spentMicro: 300_000,
      reservedMicro: 0,
    });

    const rows = await t.run(async (ctx) => ({
      report: await ctx.db.query("unboundVoiceReports").first(),
      usage: await ctx.db.query("voiceUsage").collect(),
      expenses: await ctx.db.query("providerExpenses").collect(),
    }));

    expect(rows.report).toMatchObject({
      providerCallId: "call_1",
      status: "settled",
    });

    expect(rows.usage).toHaveLength(1);
    expect(rows.usage[0]).toMatchObject({
      providerCallId: "call_1",
      costMicro: 300_000,
      customerChargeMicro: 300_000,
    });
    expect(rows.usage[0].unreserved).not.toBe(true);

    expect(rows.expenses).toHaveLength(1);
    expect(rows.expenses[0]).toMatchObject({
      providerCallId: "call_1",
      costMicro: 300_000,
    });

    await assertLedgerInvariants(t);
  });
});

describe("unused reservations are released only when no call can still exist", () => {
  const T0 = Date.UTC(2026, 10, 2, 12, 0, 0);

  it("keeps the hold until token expiry + max duration + grace, then releases it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const t = newT();
    const s = await seed(t, T0);
    const res = await openOk(t, s.A1);
    // deadline = token expiry (300 s) + 600 s + 120 s grace
    const deadline = res.tokenExpiresAt + 720_000;

    vi.setSystemTime(deadline - 1);
    expect(
      await t.mutation(internal.features.voice.internal.voiceWallet.expireHolds, {}),
    ).toEqual({ expired: 0 });
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(RESERVE);

    vi.setSystemTime(deadline);
    expect(
      await t.mutation(internal.features.voice.internal.voiceWallet.expireHolds, {}),
    ).toEqual({ expired: 1 });
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(0);
    expect((await t.run((ctx) => ctx.db.get(res.reservationId)))!.status).toBe(
      "expired_no_report",
    );
    // Running it again changes nothing.
    expect(
      await t.mutation(internal.features.voice.internal.voiceWallet.expireHolds, {}),
    ).toEqual({ expired: 0 });
    await assertLedgerInvariants(t);
  });

  it("a late report after hold expiry is still charged against its previously bound reservation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const t = newT();
    const s = await seed(t, T0);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);
    vi.setSystemTime(res.tokenExpiresAt + 720_000);
    await t.mutation(internal.features.voice.internal.voiceWallet.expireHolds, {});
    await settle(t, { costMicro: 900_000 });
    expect(await walletFor(t, "org_A")).toMatchObject({
      reservedMicro: 0,
      spentMicro: 900_000,
    });
    expect(
      (await t.run((ctx) => ctx.db.query("voiceUsage").first()))!.unreserved,
    ).toBe(false);
    await assertLedgerInvariants(t);
  });

  it("expiry housekeeping COMMITS even when the same request is then denied", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    stubVoiceEnv({ VOICE_MAX_AUTHORIZATIONS_PER_SESSION: "1" });
    const t = newT();
    const s = await seed(t, T0);
    const res = await openOk(t, s.A1);
    vi.setSystemTime(res.tokenExpiresAt + 720_000);

    // A1 already used its one authorization: this is denied, but the expired hold must still be released.
    expect(await reserve(t, s.A1)).toEqual({
      ok: false,
      code: "SESSION_LIMIT",
    });
    expect((await t.run((ctx) => ctx.db.get(res.reservationId)))!.status).toBe(
      "expired_no_report",
    );
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(0);
    await assertLedgerInvariants(t);
  });

  it("releases a hold immediately only for a token that was never issued", async () => {
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    expect(
      await t.mutation(internal.features.voice.internal.voiceWallet.releaseUnissued, {
        reservationId: res.reservationId,
      }),
    ).toEqual({ released: true });
    expect(
      await t.mutation(internal.features.voice.internal.voiceWallet.releaseUnissued, {
        reservationId: res.reservationId,
      }),
    ).toEqual({ released: false });
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(0);
    // A settled reservation can never be "released unissued".
    const again = await openOk(t, s.A1);
    await bind(t, again.reservationId);
    await settle(t);
    expect(
      await t.mutation(internal.features.voice.internal.voiceWallet.releaseUnissued, {
        reservationId: again.reservationId,
      }),
    ).toEqual({ released: false });
    await assertLedgerInvariants(t);
  });
});

describe("plan changes", () => {
  it("a mid-period upgrade tops the budget up by the difference only", async () => {
    const t = newT();
    const s = await seed(t);
    const res = await openOk(t, s.A1);
    await bind(t, res.reservationId);
    expect((await walletFor(t, "org_A"))!.budgetMicro).toBe(14_750_000);

    await t.run(async (ctx) => {
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_organization_id", (q) => q.eq("organizationId", "org_A"))
        .unique();
      await ctx.db.patch(sub!._id, { plan: "enterprise" });
    });
    await settle(t); // free the single concurrent slot
    await openOk(t, s.A1);
    expect(await walletFor(t, "org_A")).toMatchObject({
      budgetMicro: 49_750_000,
    });
    await assertLedgerInvariants(t);
  });

  it("a downgrade never claws back an already-granted budget", async () => {
    const t = newT();
    const s = await seed(t);
    await t.run(async (ctx) => {
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_organization_id", (q) => q.eq("organizationId", "org_B"))
        .unique();
      await ctx.db.patch(sub!._id, { plan: "enterprise" });
    });
    const res = await openOk(t, s.B1);
    await bind(t, res.reservationId, "cb", "asst_B");
    await settle(t, {
      assistantId: "asst_B",
      providerCallId: "cb",
      eventKey: "kb",
    });
    await t.run(async (ctx) => {
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_organization_id", (q) => q.eq("organizationId", "org_B"))
        .unique();
      await ctx.db.patch(sub!._id, { plan: "pro" });
    });
    await openOk(t, s.B1);
    expect((await walletFor(t, "org_B"))!.budgetMicro).toBe(49_750_000);
  });
});

describe("free-demo expense tracking (separate from tenant wallets)", () => {
  it("records the platform's cost against the demo organization without touching any wallet", async () => {
    const t = newT();

    expect(
      await t.mutation(internal.features.voice.internal.voiceWallet.recordFreeDemoExpense, {
        providerCallId: "demo_1",
        organizationId: "org_F",
        costMicro: 40_000,
      }),
    ).toEqual({ recorded: true, reconciled: false });

    const exp = await t.run((ctx) =>
      ctx.db.query("providerExpenses").first(),
    );

    expect(exp).toMatchObject({
      kind: "free_demo",
      organizationId: "org_F",
      costStatus: "known",
      costMicro: 40_000,
    });

    expect(
      await t.run((ctx) => ctx.db.query("voiceWallets").collect()),
    ).toHaveLength(0);
  });

  it("keeps an unknown demo cost pending, and fills it in later without duplicating", async () => {
    const t = newT();

    await t.mutation(internal.features.voice.internal.voiceWallet.recordFreeDemoExpense, {
      providerCallId: "demo_2",
      organizationId: "org_F",
    });
    let exp = await t.run((ctx) => ctx.db.query("providerExpenses").collect());
    expect(exp).toHaveLength(1);
    expect(exp[0]).toMatchObject({ costStatus: "pending" });
    expect(exp[0]!.costMicro).toBeUndefined();

    await t.mutation(internal.features.voice.internal.voiceWallet.recordFreeDemoExpense, {
      providerCallId: "demo_2",
      costMicro: 55_000,
    });
    await t.mutation(internal.features.voice.internal.voiceWallet.recordFreeDemoExpense, {
      providerCallId: "demo_2",
      costMicro: 99_000,
    }); // a later value never overwrites a known one
    exp = await t.run((ctx) => ctx.db.query("providerExpenses").collect());
    expect(exp).toHaveLength(1);
    expect(exp[0]).toMatchObject({ costStatus: "known", costMicro: 55_000 });
  });
});

describe("revenue accounting from verified Polar orders", () => {
  const paid = (over: Record<string, unknown> = {}) => ({
    polarOrderId: "ord_1",
    organizationId: "org_A",
    type: "order.paid" as const,
    netMicro: 59_000_000,
    refundedTotalMicro: 0,
    feeMicro: 2_500_000,
    occurredAt: Date.now(),
    ...over,
  });
  const apply = (t: T, a: ReturnType<typeof paid>) =>
    t.mutation(internal.features.revenue.internal.revenue.applyPolarOrderEvent, a);
  const entries = (t: T) =>
    t.run((ctx) => ctx.db.query("revenueEntries").collect());

  it("records net payment and the reported fee once; redelivery adds nothing", async () => {
    const t = newT();
    expect(await apply(t, paid())).toEqual({ ok: true, recorded: 2 });
    expect(await apply(t, paid())).toEqual({ ok: true, recorded: 0 });
    const e = await entries(t);
    expect(e.map((x) => [x.kind, x.amountMicro]).sort()).toEqual([
      ["payment", 59_000_000],
      ["platform_fee", 2_500_000],
    ]);
  });

  it("records no fee entry when Polar reports none (unknown is not zero)", async () => {
    const t = newT();
    await apply(t, paid({ feeMicro: undefined }));
    expect((await entries(t)).map((x) => x.kind)).toEqual(["payment"]);
  });

  it("refunds are cumulative: only the new amount is recorded, in any order", async () => {
    const t = newT();
    // the refund event arrives BEFORE the paid event
    await apply(
      t,
      paid({ type: "order.refunded", refundedTotalMicro: 10_000_000 }),
    );
    await apply(t, paid());
    await apply(
      t,
      paid({ type: "order.refunded", refundedTotalMicro: 10_000_000 }),
    ); // redelivery
    await apply(
      t,
      paid({ type: "order.refunded", refundedTotalMicro: 25_000_000 }),
    ); // further refund
    await apply(
      t,
      paid({ type: "order.refunded", refundedTotalMicro: 10_000_000 }),
    ); // stale, older cumulative total
    const refunds = (await entries(t))
      .filter((x) => x.kind === "refund")
      .map((x) => x.amountMicro)
      .sort((a, b) => a - b);
    expect(refunds).toEqual([10_000_000, 15_000_000]);
    expect(refunds.reduce((a, b) => a + b, 0)).toBe(25_000_000);
  });

  it("an order can never move to another organization", async () => {
    const t = newT();
    await apply(t, paid());
    expect(await apply(t, paid({ organizationId: "org_B" }))).toEqual({
      ok: false,
      code: "WRONG_ORGANIZATION",
    });
    expect((await entries(t)).every((x) => x.organizationId === "org_A")).toBe(
      true,
    );
  });

  it("rejects invalid amounts", async () => {
    const t = newT();
    expect(await apply(t, paid({ netMicro: -1 }))).toEqual({
      ok: false,
      code: "INVALID",
    });
    expect(await apply(t, paid({ netMicro: 1.5 }))).toEqual({
      ok: false,
      code: "INVALID",
    });
    expect(await entries(t)).toHaveLength(0);
  });
});
