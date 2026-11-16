import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { assertLedgerInvariants, newT, seed, stubVoiceEnv, walletFor, type T } from "./finance.testkit";

const SECRET = "whsec_test_secret_value";

beforeEach(() => {
  stubVoiceEnv();
  vi.stubEnv("VAPI_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("VAPI_DEMO_ASSISTANT_ID", "asst_demo");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const report = (call: Record<string, unknown> = {}, message: Record<string, unknown> = {}) => ({
  message: {
    type: "end-of-call-report",
    endedReason: "customer-ended-call",
    call: {
      id: "call_1",
      assistantId: "asst_A",
      startedAt: "2026-11-02T12:00:00.000Z",
      endedAt: "2026-11-02T12:01:30.000Z",
      cost: 0.0725,
      ...call,
    },
    artifact: { messages: [{ role: "user", message: "hello" }, { role: "assistant", message: "hi" }] },
    ...message,
  },
});

const demo = (
  over: Record<string, unknown> = {},
  msg: Record<string, unknown> = {},
) =>
  report(
    {
      id: "demo_1",
      assistantId: "asst_demo",
      cost: 0.04,
      ...over,
    },
    msg,
  );

const post = (t: T, body: unknown, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) =>
  t.fetch("/vapi/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const reserveA = async (t: T) => {
  const s = await seed(t);
  const reservation = await t.mutation(internal.system.voiceWallet.reserveCall, { contactSessionId: s.A1 });
  if (!reservation.ok) throw new Error(`Unable to reserve test call: ${reservation.code}`);
  return { ...s, reservationId: reservation.reservationId };
};

const bindReservation = (
  t: T,
  reservationId: unknown,
  providerCallId = "call_1",
  assistantId = "asst_A",
) =>
  t.mutation(internal.system.voiceWallet.bindCall, {
    reservationId: reservationId as never,
    providerCallId,
    assistantId,
  });

describe("free demo (central expense)", () => {
  it(
    "records the provider-reported cost as a central Free-demo expense",
    async () => {
      const t = newT();

      const res = await post(t, demo());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        route: "free-demo",
      });

      expect(
        await t.run((ctx) => ctx.db.query("providerExpenses").collect()),
      ).toHaveLength(1);

      expect(
        await t.run((ctx) => ctx.db.query("providerExpenses").first()),
      ).toMatchObject({
        kind: "free_demo",
        costStatus: "known",
        costMicro: 40_000,
        providerCallId: "demo_1",
      });

      // Centrally funded demo calls must not create or debit tenant wallets.
      expect(
        await t.run((ctx) => ctx.db.query("voiceWallets").collect()),
      ).toHaveLength(0);

      expect(
        await t.run((ctx) => ctx.db.query("voiceUsage").collect()),
      ).toHaveLength(0);
    },
    15_000,
  );

  it("acknowledges duplicate deliveries without duplicating provider expenses", async () => {
    const t = newT();

    const first = await post(t, demo());
    const second = await post(t, demo());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    expect(await second.json()).toEqual({
      ok: true,
      route: "free-demo",
    });

    expect(
      await t.run((ctx) => ctx.db.query("providerExpenses").collect()),
    ).toHaveLength(1);

    expect(
      await t.run((ctx) => ctx.db.query("voiceWallets").collect()),
    ).toHaveLength(0);
  });

  it("records a missing provider cost as pending instead of treating it as zero", async () => {
    const t = newT();

    const res = await post(t, demo({ cost: undefined }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      route: "free-demo",
    });

    const expense = await t.run((ctx) =>
      ctx.db.query("providerExpenses").first(),
    );

    expect(expense).toMatchObject({
      kind: "free_demo",
      costStatus: "pending",
      providerCallId: "demo_1",
    });

    expect(expense!.costMicro).toBeUndefined();

    expect(
      await t.run((ctx) => ctx.db.query("voiceWallets").collect()),
    ).toHaveLength(0);
  });
});

describe("authentication", () => {
  it.each([
    ["no Authorization header", {}],
    ["the wrong token", { authorization: "Bearer wrong" }],
    ["a different scheme", { authorization: `Basic ${SECRET}` }],
    ["the secret in the legacy header only", { "x-vapi-secret": SECRET }],
    ["an empty bearer", { authorization: "Bearer " }],
  ])("rejects %s with 401 and changes nothing", async (_label, headers) => {
    const t = newT();
    await reserveA(t);
    expect((await post(t, report(), headers as Record<string, string>)).status).toBe(401);
    expect(await t.run((ctx) => ctx.db.query("voiceUsage").collect())).toHaveLength(0);
  });

  it("authenticates BEFORE parsing: bad credentials with a bad body is 401, not 400", async () => {
    const t = newT();
    expect((await post(t, "{not json", { authorization: "Bearer wrong" })).status).toBe(401);
  });
});

describe("payload handling", () => {
  it("rejects invalid JSON and malformed reports with 400", async () => {
    const t = newT();
    expect((await post(t, "{not json")).status).toBe(400);
    expect((await post(t, { message: { type: "end-of-call-report" } })).status).toBe(400);
    expect((await post(t, report({ id: "bad id" }))).status).toBe(400);
    expect((await post(t, report({ assistantId: undefined }))).status).toBe(400);
    expect((await post(t, [])).status).toBe(400);
  });

  it("acknowledges other message types without doing anything", async () => {
    const t = newT();
    await reserveA(t);
    const res = await post(t, { message: { type: "status-update", status: "ended" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
    expect(await t.run((ctx) => ctx.db.query("voiceUsage").collect())).toHaveLength(0);
  });

  it("rejects an oversized body with 413", async () => {
    const t = newT();
    expect((await post(t, "x".repeat(1_000_001))).status).toBe(413);
  });
});

describe("paid calls", () => {
  it("settles using the provider-reported cost and duration, attributing to the mapped organization", async () => {
    const t = newT();
    const s = await reserveA(t);
    await bindReservation(t, s.reservationId);
    const res = await post(t, report());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, route: "paid", outcome: "settled" });

    expect(await walletFor(t, "org_A")).toMatchObject({ reservedMicro: 0, spentMicro: 72_500 });
    const usage = await t.run((ctx) => ctx.db.query("voiceUsage").first());
    expect(usage).toMatchObject({
      organizationId: "org_A", providerCallId: "call_1", costMicro: 72_500, customerChargeMicro: 72_500, durationSeconds: 90, costStatus: "known",
    });
    await assertLedgerInvariants(t);
  });

  it("a duplicate delivery returns 200 and can never charge or credit twice", async () => {
    const t = newT();
    const s = await reserveA(t);
    await bindReservation(t, s.reservationId);
    await post(t, report());
    const again = await post(t, report());
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, route: "paid", outcome: "duplicate" });
    expect(await walletFor(t, "org_A")).toMatchObject({ spentMicro: 72_500, reservedMicro: 0 });
    expect(await t.run((ctx) => ctx.db.query("voiceUsage").collect())).toHaveLength(1);
    await assertLedgerInvariants(t);
  });

  it("rejects an assistant we do not manage with 403, recording nothing", async () => {
    const t = newT();
    await reserveA(t);
    const res = await post(t, report({ assistantId: "asst_stranger" }));
    expect(res.status).toBe(403);
    expect(await t.run((ctx) => ctx.db.query("voiceUsage").collect())).toHaveLength(0);
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(2_500_000); // hold untouched
  });

  it("a report without a cost is recorded as pending, not zero, and keeps the hold", async () => {
    const t = newT();
    const s = await reserveA(t);
    await bindReservation(t, s.reservationId);
    const res = await post(t, report({ cost: undefined }));
    expect(await res.json()).toEqual({ ok: true, route: "paid", outcome: "pending_cost" });
    expect(await walletFor(t, "org_A")).toMatchObject({ reservedMicro: 2_500_000, spentMicro: 0 });
    const usage = await t.run((ctx) => ctx.db.query("voiceUsage").first());
    expect(usage).toMatchObject({ costStatus: "pending" });
    expect(usage!.costMicro).toBeUndefined();
  });

  it("flags browser assistant overrides seen on the call", async () => {
    const t = newT();
    const s = await reserveA(t);
    await bindReservation(t, s.reservationId);
    await post(t, report({ assistantOverrides: { maxDurationSeconds: 43_200 } }));
    expect((await t.run((ctx) => ctx.db.query("voiceUsage").first()))!.overridesDetected).toBe(true);
  });

  it("a call from one organization's assistant never touches another organization's wallet", async () => {
    const t = newT();
    const s = await seed(t);
    const reservationA = await t.mutation(internal.system.voiceWallet.reserveCall, { contactSessionId: s.A1 });
    const reservationB = await t.mutation(internal.system.voiceWallet.reserveCall, { contactSessionId: s.B1 });
    if (!reservationA.ok || !reservationB.ok) throw new Error("Unable to reserve cross-organization test calls");
    await bindReservation(t, reservationB.reservationId, "call_B", "asst_B");
    await post(t, report({ id: "call_B", assistantId: "asst_B", cost: 1 }));
    expect(await walletFor(t, "org_B")).toMatchObject({ spentMicro: 1_000_000, reservedMicro: 0 });
    expect(await walletFor(t, "org_A")).toMatchObject({ spentMicro: 0, reservedMicro: 2_500_000 });
  });
});