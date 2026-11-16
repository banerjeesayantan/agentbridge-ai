import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { clearCentralVapiCache } from "../lib/vapiCentral";
import { getSecretValue } from "../lib/secrets";
import { assertLedgerInvariants, newT, seed, stubVoiceEnv, walletFor } from "../finance.testkit";

vi.mock("../lib/secrets", () => ({
  getSecretValue: vi.fn(),
  parseSecretString: (o: { SecretString?: string }) => (o.SecretString ? JSON.parse(o.SecretString) : null),
}));

const PRIVATE_KEY = "vapi_private_key_do_not_leak";
const creds = () => (getSecretValue as ReturnType<typeof vi.fn>).mockResolvedValue({ SecretString: JSON.stringify({ privateApiKey: PRIVATE_KEY, orgId: "vapi-org-1" }) });

beforeEach(() => {
  stubVoiceEnv();
  clearCentralVapiCache();
  (getSecretValue as ReturnType<typeof vi.fn>).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const b64 = (s: string) => JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/")));
const authorize = (t: ReturnType<typeof newT>, contactSessionId: unknown) =>
  t.action(api.public.voicePaid.authorizeCall, { contactSessionId: contactSessionId as never });

describe("authorizeCall", () => {
  it("settles an early provider report when retrying an already-bound call", async () => {
    const t = newT();
    const s = await seed(t);

    const reservation = await t.mutation(
      internal.system.voiceWallet.reserveCall,
      { contactSessionId: s.A1 },
    );

    if (!reservation.ok) {
      throw new Error(`Reservation failed: ${reservation.code}`);
    }

    // The provider webhook arrives before the browser reports its call ID.
    expect(
      await t.mutation(internal.system.voiceWallet.settlePaidCall, {
        eventKey: "early-report",
        providerCallId: "call_binding_retry",
        assistantId: "asst_A",
        costMicro: 410_000,
        overridesDetected: false,
      }),
    ).toMatchObject({ ok: true, outcome: "pending_binding" });

    // The first attempt committed the binding.
    await t.mutation(internal.system.voiceWallet.bindCall, {
      reservationId: reservation.reservationId,
      providerCallId: "call_binding_retry",
      assistantId: "asst_A",
    });

    // A retry must settle the parked report despite the existing binding.
    expect(
      await t.action(internal.system.voiceBinding.bindReportedCall, {
        reservationId: reservation.reservationId,
        contactSessionId: s.A1,
        providerCallId: "call_binding_retry",
      }),
    ).toEqual({ ok: true, outcome: "already_bound" });

    expect(await walletFor(t, "org_A")).toMatchObject({
      reservedMicro: 0,
      spentMicro: 410_000,
    });

    const parked = await t.run((ctx) =>
      ctx.db
        .query("unboundVoiceReports")
        .withIndex("by_provider_call_id", (q) =>
          q.eq("providerCallId", "call_binding_retry"),
        )
        .first(),
    );

    expect(parked).toMatchObject({ status: "settled" });

    await assertLedgerInvariants(t);
  });

  it("each organization receives a token for ITS assistant only", async () => {
    creds();
    const t = newT();
    const s = await seed(t);
    const a = await authorize(t, s.A1);
    const b = await authorize(t, s.B1);
    expect(b64(a.token.split(".")[1]!).token.restrictions.allowedAssistantIds).toEqual(["asst_A"]);
    expect(b64(b.token.split(".")[1]!).token.restrictions.allowedAssistantIds).toEqual(["asst_B"]);
  });

  it.each([
    ["a Free organization", "F1", "PLAN_REQUIRED"],
    ["an expired session", "A_expired", "SESSION_INVALID"],
  ])("denies %s without calling the secrets store", async (_l, who, code) => {
    creds();
    const t = newT();
    const s = (await seed(t)) as Record<string, unknown>;
    await expect(authorize(t, s[who])).rejects.toThrow(new RegExp(code));
    expect(getSecretValue).not.toHaveBeenCalled();
  });

  it("denies a second concurrent call for the organization and holds nothing extra", async () => {
    creds();
    const t = newT();
    const s = await seed(t);
    await authorize(t, s.A1);
    await expect(authorize(t, s.A2)).rejects.toThrow(/IN_PROGRESS/);
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(2_500_000);
  });

  it("the same visitor retrying gets the same expiry, never a longer window", async () => {
    creds();
    const t = newT();
    const s = await seed(t);
    const first = await authorize(t, s.A1);
    const second = await authorize(t, s.A1);
    expect(second.reservationId).toBe(first.reservationId);
    expect(second.expiresAt).toBe(first.expiresAt);
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(2_500_000);
  });

  it("if no token can be issued, the hold is released immediately (no call can exist)", async () => {
    (getSecretValue as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("aws down"));
    const t = newT();
    const s = await seed(t);
    await expect(authorize(t, s.A1)).rejects.toThrow(/VOICE_UNAVAILABLE/);
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(0);
    const r = await t.run((ctx) => ctx.db.query("voiceCallReservations").first());
    expect(r!.status).toBe("released_unissued");
    await assertLedgerInvariants(t);
  });

  it("a malformed secret is treated as unavailable and never echoed", async () => {
    (getSecretValue as ReturnType<typeof vi.fn>).mockResolvedValue({ SecretString: JSON.stringify({ privateApiKey: "", orgId: "x" }) });
    const t = newT();
    const s = await seed(t);
    await expect(authorize(t, s.A1)).rejects.toThrow(/VOICE_UNAVAILABLE/);
  });

  it("a failed RE-issue does not release a reservation whose earlier token is still live", async () => {
    creds();
    const t = newT();
    const s = await seed(t);
    const first = await authorize(t, s.A1);
    clearCentralVapiCache();
    (getSecretValue as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("aws down"));
    await expect(authorize(t, s.A1)).rejects.toThrow(/VOICE_UNAVAILABLE/);
    const r = await t.run((ctx) => ctx.db.get(first.reservationId));
    expect(r!.status).toBe("authorized");
    expect((await walletFor(t, "org_A"))!.reservedMicro).toBe(2_500_000);
  });

  it("end to end: authorize, then the provider report settles exactly what was spent", async () => {
    creds();
    const t = newT();
    const s = await seed(t);
    const out = await authorize(t, s.A1);
    await t.mutation(internal.system.voiceWallet.bindCall, {
      reservationId: out.reservationId,
      providerCallId: "call_e2e",
      assistantId: out.assistantId,
    });
    await t.mutation(internal.system.voiceWallet.settlePaidCall, {
      eventKey: "e", providerCallId: "call_e2e", assistantId: out.assistantId, costMicro: 410_000, overridesDetected: false,
    });
    expect(await walletFor(t, "org_A")).toMatchObject({ reservedMicro: 0, spentMicro: 410_000 });
    await assertLedgerInvariants(t);
  });
});