import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { newT, seed, stubVoiceEnv, walletFor, type T } from "../finance.testkit";

const ADMIN = { subject: "user_admin" };
const NOT_ADMIN = { subject: "user_customer", orgId: "org_A" };

beforeEach(() => {
  stubVoiceEnv();
  vi.stubEnv("PLATFORM_ADMIN_USER_IDS", "user_admin, user_other");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const asAdmin = (t: T) => t.withIdentity(ADMIN);
const audit = (t: T) => t.run((ctx) => ctx.db.query("adminAuditLog").collect());

const reserveAndBind = async (
  t: T,
  contactSessionId: unknown,
  providerCallId: string,
  assistantId: string,
) => {
  const reservation = await t.mutation(internal.system.voiceWallet.reserveCall, {
    contactSessionId: contactSessionId as never,
  });
  if (!reservation.ok) throw new Error(`Unable to reserve test call: ${reservation.code}`);

  await t.mutation(internal.system.voiceWallet.bindCall, {
    reservationId: reservation.reservationId,
    providerCallId,
    assistantId,
  });

  return reservation.reservationId;
};

describe("admin authorization is enforced on the server", () => {
  const calls: Array<[string, (t: T) => Promise<unknown>]> = [
    ["overview", (t) => t.query(api.private.voiceAdmin.overview, {})],
    ["registerManagedAssistant", (t) => t.mutation(api.private.voiceAdmin.registerManagedAssistant, { organizationId: "org_C", vapiAssistantId: "asst_C" })],
    ["suspendOrganizationVoice", (t) => t.mutation(api.private.voiceAdmin.suspendOrganizationVoice, { organizationId: "org_A" })],
    ["restoreOrganizationVoice", (t) => t.mutation(api.private.voiceAdmin.restoreOrganizationVoice, { organizationId: "org_A" })],
    ["setProviderAccount", (t) => t.mutation(api.private.voiceAdmin.setProviderAccount, { paused: true })],
    ["setRevenueAllocation", (t) => t.mutation(api.private.voiceAdmin.setRevenueAllocation, { parts: [{ key: "operating", bps: 10_000 }] })],
    ["reconcileCallCost", (t) => t.mutation(api.private.voiceAdmin.reconcileCallCost, { providerCallId: "call_1", costUsd: 1 })],
  ];

  it.each(calls)("%s rejects an unauthenticated caller", async (_name, call) => {
    const t = newT();
    await expect(call(t)).rejects.toThrow(/UNAUTHORIZED/);
  });

  it.each(calls)("%s rejects a signed-in customer who is not a platform admin", async (_name, call) => {
    const t = newT();
    await expect(call(t.withIdentity(NOT_ADMIN) as unknown as T)).rejects.toThrow(/FORBIDDEN/);
  });

  it("nobody is admin when PLATFORM_ADMIN_USER_IDS is unset or empty", async () => {
    for (const value of [undefined, "", " , "]) {
      vi.unstubAllEnvs();
      if (value !== undefined) vi.stubEnv("PLATFORM_ADMIN_USER_IDS", value);
      const t = newT();
      await expect(t.withIdentity(ADMIN).query(api.private.voiceAdmin.overview, {})).rejects.toThrow(/FORBIDDEN/);
    }
  });

  it("a customer cannot mutate state, and nothing is written or audited", async () => {
    const t = newT();
    await seed(t);
    await expect(t.withIdentity(NOT_ADMIN).mutation(api.private.voiceAdmin.suspendOrganizationVoice, { organizationId: "org_A" })).rejects.toThrow(/FORBIDDEN/);
    expect(await t.run((ctx) => ctx.db.query("orgVoiceControls").collect())).toHaveLength(0);
    expect(await audit(t)).toHaveLength(0);
  });
});

describe("amIAdmin (UI convenience, decides nothing)", () => {
  it("reports true only for a listed admin and never throws", async () => {
    const t = newT();
    expect(await t.query(api.private.voiceAdmin.amIAdmin, {})).toEqual({ isAdmin: false });
    expect(await t.withIdentity(NOT_ADMIN).query(api.private.voiceAdmin.amIAdmin, {})).toEqual({ isAdmin: false });
    expect(await t.withIdentity(ADMIN).query(api.private.voiceAdmin.amIAdmin, {})).toEqual({ isAdmin: true });
  });

  it("the overview includes the most recent audit entries", async () => {
    const t = newT();
    await asAdmin(t).mutation(api.private.voiceAdmin.suspendOrganizationVoice, { organizationId: "org_A" });
    const o = await asAdmin(t).query(api.private.voiceAdmin.overview, {});
    expect(o.audit[0]).toMatchObject({ actor: "user_admin", action: "suspendOrganizationVoice", target: "org_A" });
  });
});

describe("admin operations", () => {
  it("registers a managed assistant, audited, and refuses conflicting mappings", async () => {
    const t = newT();
    const a = asAdmin(t);
    expect(await a.mutation(api.private.voiceAdmin.registerManagedAssistant, { organizationId: "org_C", vapiAssistantId: "asst_C" })).toEqual({ ok: true });
    // the same call again is harmless
    await a.mutation(api.private.voiceAdmin.registerManagedAssistant, { organizationId: "org_C", vapiAssistantId: "asst_C" });
    expect(await t.run((ctx) => ctx.db.query("managedAssistants").collect())).toHaveLength(1);
    // assistant already owned by another org
    await expect(a.mutation(api.private.voiceAdmin.registerManagedAssistant, { organizationId: "org_D", vapiAssistantId: "asst_C" })).rejects.toThrow(/CONFLICT/);
    // org already has a different assistant
    await expect(a.mutation(api.private.voiceAdmin.registerManagedAssistant, { organizationId: "org_C", vapiAssistantId: "asst_X" })).rejects.toThrow(/CONFLICT/);
    // malformed identifiers
    await expect(a.mutation(api.private.voiceAdmin.registerManagedAssistant, { organizationId: "not-an-org", vapiAssistantId: "asst_Y" })).rejects.toThrow(/INVALID/);
    await expect(a.mutation(api.private.voiceAdmin.registerManagedAssistant, { organizationId: "org_E", vapiAssistantId: "bad id!" })).rejects.toThrow(/INVALID/);

    const log = await audit(t);
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0]).toMatchObject({ actorUserId: "user_admin", action: "registerManagedAssistant", targetId: "org_C" });
  });

  it("refuses to map the Free-demo assistant to an organization", async () => {
    vi.stubEnv("VAPI_DEMO_ASSISTANT_ID", "asst_demo");
    const t = newT();
    await expect(asAdmin(t).mutation(api.private.voiceAdmin.registerManagedAssistant, { organizationId: "org_C", vapiAssistantId: "asst_demo" })).rejects.toThrow(/CONFLICT/);
    expect(await t.run((ctx) => ctx.db.query("managedAssistants").collect())).toHaveLength(0);
  });

  it("suspension blocks new paid calls immediately, restoration re-enables them, both audited", async () => {
    const t = newT();
    const s = await seed(t);
    const a = asAdmin(t);
    await a.mutation(api.private.voiceAdmin.suspendOrganizationVoice, { organizationId: "org_A", reason: "chargeback review" });
    expect(await t.mutation(internal.system.voiceWallet.reserveCall, { contactSessionId: s.A1 })).toEqual({ ok: false, code: "ORG_SUSPENDED" });
    await a.mutation(api.private.voiceAdmin.restoreOrganizationVoice, { organizationId: "org_A" });
    expect((await t.mutation(internal.system.voiceWallet.reserveCall, { contactSessionId: s.A1 })).ok).toBe(true);
    expect((await audit(t)).map((x) => x.action)).toEqual(["suspendOrganizationVoice", "restoreOrganizationVoice"]);
  });

  it("provider pause blocks all organizations; a manual balance is labelled manual", async () => {
    const t = newT();
    const s = await seed(t);
    const a = asAdmin(t);
    await a.mutation(api.private.voiceAdmin.setProviderAccount, { balanceMicro: 5_000_000, lowBalanceThresholdMicro: 6_000_000, paused: true });
    expect(await t.mutation(internal.system.voiceWallet.reserveCall, { contactSessionId: s.A1 })).toEqual({ ok: false, code: "PROVIDER_PAUSED" });
    expect(await t.mutation(internal.system.voiceWallet.reserveCall, { contactSessionId: s.B1 })).toEqual({ ok: false, code: "PROVIDER_PAUSED" });
    const o = await a.query(api.private.voiceAdmin.overview, {});
    expect(o.provider).toEqual({ balanceMicro: 5_000_000, balanceSource: "manual", paused: true, lowBalance: true });
    await expect(a.mutation(api.private.voiceAdmin.setProviderAccount, { balanceMicro: -1 })).rejects.toThrow(/INVALID/);
    await expect(a.mutation(api.private.voiceAdmin.setProviderAccount, { balanceMicro: 1.5 })).rejects.toThrow(/INVALID/);
  });

  it("validates the revenue allocation before storing it", async () => {
    const t = newT();
    const a = asAdmin(t);
    await expect(a.mutation(api.private.voiceAdmin.setRevenueAllocation, { parts: [{ key: "operating", bps: 9_000 }] })).rejects.toThrow(/INVALID/);
    await expect(a.mutation(api.private.voiceAdmin.setRevenueAllocation, { parts: [{ key: "x", bps: 10_000 }] })).rejects.toThrow(/INVALID/); // no operating part
    await a.mutation(api.private.voiceAdmin.setRevenueAllocation, { parts: [{ key: "vapiReserve", bps: 3_000 }, { key: "operating", bps: 7_000 }] });
    const o = await a.query(api.private.voiceAdmin.overview, {});
    expect(o.allocation).toEqual([{ key: "vapiReserve", bps: 3_000 }, { key: "operating", bps: 7_000 }]);
  });

  it("reconciles a pending cost from USD and records the audit", async () => {
    const t = newT();
    const s = await seed(t);
    await reserveAndBind(t, s.A1, "call_1", "asst_A");
    await t.mutation(internal.system.voiceWallet.settlePaidCall, {
      eventKey: "k", providerCallId: "call_1", assistantId: "asst_A", overridesDetected: false,
    });
    await asAdmin(t).mutation(api.private.voiceAdmin.reconcileCallCost, { providerCallId: "call_1", costUsd: 0.0725 });
    expect(await walletFor(t, "org_A")).toMatchObject({ reservedMicro: 0, spentMicro: 72_500 });
    expect((await audit(t)).at(-1)).toMatchObject({ action: "reconcileCallCost", targetId: "call_1" });
    await expect(asAdmin(t).mutation(api.private.voiceAdmin.reconcileCallCost, { providerCallId: "call_1", costUsd: -1 })).rejects.toThrow(/INVALID/);
    await expect(asAdmin(t).mutation(api.private.voiceAdmin.reconcileCallCost, { providerCallId: "bad id", costUsd: 1 })).rejects.toThrow(/INVALID/);
  });
});

describe("admin overview: separate, honest financial numbers", () => {
  it("reports revenue, actual expense and contribution per organization, flagging pending costs", async () => {
    const t = newT();
    const s = await seed(t);
    const now = Date.now();
    await t.mutation(internal.system.revenue.applyPolarOrderEvent, {
      polarOrderId: "ord_A", organizationId: "org_A", type: "order.paid", netMicro: 59_000_000, refundedTotalMicro: 0, feeMicro: 2_500_000, occurredAt: now,
    });
    await reserveAndBind(t, s.A1, "c1", "asst_A");
    await t.mutation(internal.system.voiceWallet.settlePaidCall, {
      eventKey: "k1", providerCallId: "c1", assistantId: "asst_A", costMicro: 4_000_000, overridesDetected: false, endedAtMs: now,
    });
    await reserveAndBind(t, s.A1, "c2", "asst_A");
    await t.mutation(internal.system.voiceWallet.settlePaidCall, {
      eventKey: "k2", providerCallId: "c2", assistantId: "asst_A", overridesDetected: true, endedAtMs: now,
    });

    const o = await asAdmin(t).query(api.private.voiceAdmin.overview, {});
    const org = o.organizations.find((x) => x.organizationId === "org_A")!;
    expect(org.accounting).toMatchObject({
      grossPaymentsMicro: 59_000_000, platformFeesMicro: 2_500_000, netCollectedMicro: 56_500_000,
      vapiExpenseKnownMicro: 4_000_000, contributionMicro: 52_500_000, pendingCostCalls: 1, provisional: true,
    });
    // Reserved funds are a liability concept and never appear as earnings.
    expect(org.wallet.reservedMicro).toBe(2_500_000);
    expect(org.accounting.contributionMicro).toBe(56_500_000 - 4_000_000);
    expect(o.reconciliation).toMatchObject({ pendingCostExpenses: 1, callsWithOverrides: 1 });
    expect(o.totals).toMatchObject({ netCollectedMicro: 56_500_000, vapiExpenseKnownMicro: 4_000_000, pendingCostCalls: 1 });
    expect(o.liabilities.reservedMicro).toBe(2_500_000);
  });

  it("flags organizations that are over or near budget", async () => {
    const t = newT();
    const s = await seed(t);
    await reserveAndBind(t, s.A1, "c", "asst_A");
    await t.mutation(internal.system.voiceWallet.settlePaidCall, {
      eventKey: "k", providerCallId: "c", assistantId: "asst_A", costMicro: 20_000_000, overridesDetected: false,
    });
    const o = await asAdmin(t).query(api.private.voiceAdmin.overview, {});
    expect(o.organizations[0]).toMatchObject({ overBudget: true, nearBudget: true });

    expect(o.costAlerts).toHaveLength(2);
    expect(o.costAlerts.map((alert) => alert.alertType).sort()).toEqual([
      "BUDGET_EXCEEDED",
      "RESERVATION_OVERRUN",
    ]);

    expect(o.costAlerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: "org_A",
          providerCallId: "c",
          reservedMicro: 2_500_000,
          actualCostMicro: 20_000_000,
          budgetMicro: 14_750_000,
          resultingSpentMicro: 20_000_000,
        }),
      ]),
    );
  });
});

describe("customer voice summary is scoped to the caller's organization", () => {
  it("shows only this organization's allowance and usage, with no platform or provider data", async () => {
    const t = newT();
    const s = await seed(t);
    await reserveAndBind(t, s.A1, "c", "asst_A");
    await t.mutation(internal.system.voiceWallet.settlePaidCall, {
      eventKey: "k", providerCallId: "c", assistantId: "asst_A", costMicro: 1_500_000, overridesDetected: false, durationSeconds: 75,
    });
    await reserveAndBind(t, s.B1, "cb", "asst_B");
    await t.mutation(internal.system.voiceWallet.settlePaidCall, {
      eventKey: "kb", providerCallId: "cb", assistantId: "asst_B", costMicro: 9_000_000, overridesDetected: false,
    });
    await asAdmin(t).mutation(api.private.voiceAdmin.setProviderAccount, { balanceMicro: 123 });

    const a = await t.withIdentity({ subject: "user_x", orgId: "org_A" }).query(api.private.voiceBilling.summary, {});
    expect(a).toMatchObject({ plan: "pro", status: "available", budgetMicro: 14_750_000, spentMicro: 1_500_000, reservedMicro: 0, remainingMicro: 13_250_000 });
    expect(a.recentCalls).toEqual([{ endedAtMs: expect.any(Number), durationSeconds: 75, chargeMicro: 1_500_000, costStatus: "known" }]);
    const keys = JSON.stringify(a);
    for (const leaked of ["balance", "revenue", "asst_", "org_B", "9000000", "123"]) expect(keys).not.toContain(leaked);

    const b = await t.withIdentity({ subject: "user_y", orgId: "org_B" }).query(api.private.voiceBilling.summary, {});
    expect(b).toMatchObject({ plan: "enterprise", spentMicro: 9_000_000 });
  });

  it("reports the right status for each situation", async () => {
    const t = newT();
    const s = await seed(t);
    const as = (org: string) => t.withIdentity({ subject: "u", orgId: org }).query(api.private.voiceBilling.summary, {});

    expect((await as("org_F")).status).toBe("plan_required");
    expect((await as("org_A")).status).toBe("available");
    await asAdmin(t).mutation(api.private.voiceAdmin.suspendOrganizationVoice, { organizationId: "org_A" });
    expect((await as("org_A")).status).toBe("suspended");
    await asAdmin(t).mutation(api.private.voiceAdmin.restoreOrganizationVoice, { organizationId: "org_A" });
    await reserveAndBind(t, s.A1, "c", "asst_A");
    await t.mutation(internal.system.voiceWallet.settlePaidCall, {
      eventKey: "k", providerCallId: "c", assistantId: "asst_A", costMicro: 20_000_000, overridesDetected: false,
    });
    expect((await as("org_A")).status).toBe("budget_used");
    expect((await as("org_A")).remainingMicro).toBe(0); // never negative on screen
  });

  it("requires a signed-in user with an organization", async () => {
    const t = newT();
    await expect(t.query(api.private.voiceBilling.summary, {})).rejects.toThrow(/UNAUTHORIZED/);
    await expect(t.withIdentity({ subject: "u" }).query(api.private.voiceBilling.summary, {})).rejects.toThrow(/UNAUTHORIZED/);
  });
});
