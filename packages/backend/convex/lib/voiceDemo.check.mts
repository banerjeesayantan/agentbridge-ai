import assert from "node:assert/strict";
import { chargedSeconds, isSuccessfulSession, periodKey, pickProvider, readConfig, remaining } from "./voiceDemo";
const base = { VOICE_DEMO_ENABLED: "true", VOICE_DEMO_GLOBAL_BUDGET_SECONDS: "1000", VOICE_DEMO_VAPI_BUDGET_SECONDS: "400", VOICE_DEMO_MAX_SESSION_SECONDS: "180" };
const cfg = readConfig(base);
const ok = new Set(["vapi"] as const);
let n = 0; const t = (name: string, f: () => void) => { f(); n++; console.log("ok", name); };

t("fail closed: no budgets configured => no capacity", () => {
  const c = readConfig({ VOICE_DEMO_ENABLED: "true" });
  assert.equal(pickProvider({ config: c, quota: { global: null, providers: {} }, available: ok }), null);
});
t("disabled unless exactly 'true'", () => { assert.equal(readConfig({ VOICE_DEMO_ENABLED: "1" }).enabled, false); assert.equal(readConfig({}).enabled, false); });
t("invalid numbers fall back to safe defaults / zero budget", () => {
  const c = readConfig({ VOICE_DEMO_GLOBAL_BUDGET_SECONDS: "-5", VOICE_DEMO_VAPI_BUDGET_SECONDS: "abc", VOICE_DEMO_MAX_SESSION_SECONDS: "99999" });
  assert.equal(c.globalBudgetSeconds, 0); assert.equal(c.providerBudgetSeconds.vapi, 0); assert.equal(c.maxSessionSeconds, 180);
});
t("unknown providers in the order are ignored (never assumed)", () => {
  assert.deepEqual(readConfig({ VOICE_DEMO_PROVIDER_ORDER: "elevenlabs, vapi, vapi, livekit" }).order, ["vapi"]);
});
t("first session fits provider and global budget", () => {
  assert.equal(pickProvider({ config: cfg, quota: { global: null, providers: {} }, available: ok }), "vapi");
});
t("provider budget exhausted => null (fallback unavailable, nothing charged)", () => {
  const q = { global: { reservedSeconds: 0, usedSeconds: 300 }, providers: { vapi: { reservedSeconds: 0, usedSeconds: 300 } } };
  assert.equal(pickProvider({ config: cfg, quota: q, available: ok }), null); // 100 left < 180
});
t("reservations count: concurrent holds cannot exceed the budget", () => {
  // Simulate serialized transactions: each reservation is applied before the next check.
  const q = { global: { reservedSeconds: 0, usedSeconds: 0 }, providers: { vapi: { reservedSeconds: 0, usedSeconds: 0 } } as any };
  let granted = 0;
  for (let i = 0; i < 20; i++) {
    if (pickProvider({ config: cfg, quota: q, available: ok })) { granted++; q.global.reservedSeconds += 180; q.providers.vapi.reservedSeconds += 180; }
  }
  assert.equal(granted, 2); // 400s provider budget / 180s = 2 sessions
});
t("global cap binds even when the provider has room", () => {
  const c = readConfig({ ...base, VOICE_DEMO_GLOBAL_BUDGET_SECONDS: "200" });
  const q = { global: { reservedSeconds: 180, usedSeconds: 0 }, providers: {} };
  assert.equal(pickProvider({ config: c, quota: q, available: ok }), null);
});
t("unavailable provider (missing public config) is skipped", () => {
  assert.equal(pickProvider({ config: cfg, quota: { global: null, providers: {} }, available: new Set() }), null);
});
t("excluded (already failed) provider is skipped", () => {
  assert.equal(pickProvider({ config: cfg, quota: { global: null, providers: {} }, available: ok, exclude: new Set(["vapi"]) }), null);
});
t("remaining never negative", () => assert.equal(remaining(100, { reservedSeconds: 90, usedSeconds: 90 }), 0));

const crit = { minSuccessSeconds: 20, minUserTurns: 1 };
t("success needs start + duration + a user turn + no error", () => {
  const s = { started: true, serverElapsedSeconds: 60, clientDurationSeconds: 60, userTurns: 2, providerError: false, config: crit };
  assert.equal(isSuccessfulSession(s), true);
  assert.equal(isSuccessfulSession({ ...s, started: false }), false);
  assert.equal(isSuccessfulSession({ ...s, userTurns: 0 }), false);
  assert.equal(isSuccessfulSession({ ...s, providerError: true }), false);
  assert.equal(isSuccessfulSession({ ...s, serverElapsedSeconds: 5, clientDurationSeconds: 500 }), false); // client cannot inflate
  assert.equal(isSuccessfulSession({ ...s, clientDurationSeconds: 5 }), false);
});
t("a start attempt alone is never success", () => {
  assert.equal(isSuccessfulSession({ started: false, serverElapsedSeconds: 0, clientDurationSeconds: 0, userTurns: 0, providerError: false, config: crit }), false);
});
t("charge uses server time, capped at the reservation; client cannot lower it", () => {
  assert.equal(chargedSeconds(61.2, 180), 62); assert.equal(chargedSeconds(9999, 180), 180); assert.equal(chargedSeconds(-3, 180), 0);
});
t("period keys", () => {
  assert.equal(periodKey({ period: "total" }, Date.UTC(2026, 9, 1)), "total");
  assert.equal(periodKey({ period: "monthly" }, Date.UTC(2026, 9, 1)), "2026-10");
});
console.log(`${n} passed`);
