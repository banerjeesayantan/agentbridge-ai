import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { computeOrgAccounting } from "./accounting.ts";
import { DEFAULT_ALLOCATION, formatUsd, isMicro, splitByBasisPoints, usdToMicro, validateAllocation } from "./money.ts";
import { isPlatformAdmin, platformAdminIds } from "./platformAdmin.ts";
import { parsePolarOrderEvent } from "./polarOrder.ts";
import { signVapiPublicToken } from "./vapiJwt.ts";
import { extractBearerToken, parseVapiMessage, secretsMatch, successEndedReasons } from "./vapiWebhook.ts";
import { holdDeadline, parseOrigins, readVoiceBudgetConfig } from "./voiceBudget.ts";

let n = 0;
const t = async (name: string, f: () => void | Promise<void>) => {
  await f();
  n++;
  console.log("ok", name);
};

// ---------------------------------------------------------------- money
await t("usdToMicro converts once, rounds, and never turns unknown into zero", () => {
  assert.equal(usdToMicro(0.07), 70_000); // 0.07 * 1e6 is 70000.00000000001 in floating point
  assert.equal(usdToMicro(1.2345678), 1_234_568);
  assert.equal(usdToMicro(0), 0); // a REPORTED zero is a real zero
  for (const bad of [undefined, null, "1.5", Number.NaN, Number.POSITIVE_INFINITY, -0.01, {}]) {
    assert.equal(usdToMicro(bad), null, String(bad));
  }
});
await t("isMicro accepts only non-negative safe integers", () => {
  assert.equal(isMicro(0), true);
  assert.equal(isMicro(14_750_000), true);
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, "5", null]) assert.equal(isMicro(bad), false);
});
await t("formatUsd", () => {
  assert.equal(formatUsd(14_750_000), "$14.75");
  assert.equal(formatUsd(49_750_000), "$49.75");
  assert.equal(formatUsd(12_346), "$0.012346");
  assert.equal(formatUsd(0), "$0.00");
});
await t("allocation: default is 25/15/60 and sums exactly", () => {
  assert.equal(validateAllocation(DEFAULT_ALLOCATION), true);
  const s = splitByBasisPoints(59_000_000);
  assert.deepEqual(s, { vapiReserve: 14_750_000, infrastructureReserve: 8_850_000, operating: 35_400_000 });
  const t199 = splitByBasisPoints(199_000_000);
  assert.equal(t199.vapiReserve, 49_750_000);
});
await t("allocation: rounding remainder goes to the operating part, deterministically", () => {
  for (const amount of [0, 1, 2, 3, 7, 99, 101, 12_345_679, 9_007_199_254_740_991]) {
    const s = splitByBasisPoints(amount);
    assert.equal(s.vapiReserve! + s.infrastructureReserve! + s.operating!, amount, `amount ${amount}`);
    assert.deepEqual(s, splitByBasisPoints(amount)); // deterministic
  }
  assert.deepEqual(splitByBasisPoints(1), { vapiReserve: 0, infrastructureReserve: 0, operating: 1 });
});
await t("allocation: invalid configurations are rejected", () => {
  assert.equal(validateAllocation([{ key: "a", bps: 5_000 }]), false); // totals 5000
  assert.equal(validateAllocation([{ key: "a", bps: 10_001 }]), false);
  assert.equal(validateAllocation([{ key: "a", bps: 5_000.5 }, { key: "b", bps: 4_999.5 }]), false);
  assert.equal(validateAllocation([{ key: "a", bps: -1 }, { key: "b", bps: 10_001 }]), false);
  assert.equal(validateAllocation([{ key: "a", bps: 5_000 }, { key: "a", bps: 5_000 }]), false); // duplicate key
  assert.throws(() => splitByBasisPoints(-1), RangeError);
  assert.throws(() => splitByBasisPoints(1.5), RangeError);
  assert.throws(() => splitByBasisPoints(100, DEFAULT_ALLOCATION, "missing"), RangeError);
});

// ------------------------------------------------------- budget config
const goodEnv = {
  VOICE_PAID_MAX_CALL_SECONDS: "600",
  VOICE_MAX_COST_PER_MINUTE_MICRO: "250000",
  VOICE_ALLOWED_ORIGINS: "https://widget.example.com",
};
await t("budget config: required values missing => not ready (fail closed)", () => {
  assert.equal(readVoiceBudgetConfig({}).ready, false);
  for (const drop of Object.keys(goodEnv)) {
    const env: Record<string, string> = { ...goodEnv };
    delete env[drop];
    assert.equal(readVoiceBudgetConfig(env).ready, false, `without ${drop}`);
  }
  assert.equal(readVoiceBudgetConfig(goodEnv).ready, true);
});
await t("budget config: defaults are the agreed initial budgets and a sized reservation", () => {
  const c = readVoiceBudgetConfig(goodEnv);
  assert.equal(c.planBudgetMicro.pro, 14_750_000);
  assert.equal(c.planBudgetMicro.enterprise, 49_750_000);
  assert.equal(c.reservationMicro, 2_500_000); // 600 s = 10 min x 250_000 micro-dollars per minute
  assert.equal(c.tokenTtlSeconds, 300);
  assert.equal(c.maxConcurrentPerOrg, 1);
  assert.deepEqual(c.allowedOrigins, ["https://widget.example.com"]);
});
await t("budget config: invalid values fail closed", () => {
  for (const bad of ["9", "43201", "abc", "1.5", "-5"]) {
    assert.equal(readVoiceBudgetConfig({ ...goodEnv, VOICE_PAID_MAX_CALL_SECONDS: bad }).ready, false, `max seconds ${bad}`);
  }
  assert.equal(readVoiceBudgetConfig({ ...goodEnv, VOICE_MAX_COST_PER_MINUTE_MICRO: "0" }).ready, false);
  assert.equal(readVoiceBudgetConfig({ ...goodEnv, VOICE_TOKEN_TTL_SECONDS: "5" }).ready, false);
  assert.equal(readVoiceBudgetConfig({ ...goodEnv, VOICE_MAX_CONCURRENT_PER_ORG: "0" }).ready, false);
  // A SET-but-invalid budget denies (0) instead of silently using the default.
  assert.equal(readVoiceBudgetConfig({ ...goodEnv, VOICE_BUDGET_PRO_MICRO: "abc" }).planBudgetMicro.pro, 0);
  assert.equal(readVoiceBudgetConfig({ ...goodEnv, VOICE_BUDGET_PRO_MICRO: "-5" }).planBudgetMicro.pro, 0);
});
await t("origins: normalized, deduplicated, and one bad entry invalidates the list", () => {
  assert.deepEqual(parseOrigins("https://a.com/path, https://a.com ,http://localhost:3000"), ["https://a.com", "http://localhost:3000"]);
  assert.deepEqual(parseOrigins("https://a.com, not a url"), []);
  assert.deepEqual(parseOrigins("javascript:alert(1)"), []);
  assert.deepEqual(parseOrigins(undefined), []);
});
await t("hold deadline = token expiry + max duration + grace", () => {
  assert.equal(holdDeadline(1_000_000, { maxCallSeconds: 600, startGraceSeconds: 120 }), 1_000_000 + 720_000);
});

// ------------------------------------------------------------ Vapi JWT
const b64urlJson = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
await t("JWT: HS256 signature verifies independently and claims are restricted to one assistant", async () => {
  const now = Date.UTC(2026, 10, 2, 12, 0, 0);
  const { token, expiresAt } = await signVapiPublicToken({
    orgId: "vapi-org-1",
    privateKey: "private-key-value",
    assistantId: "asst_1",
    allowedOrigins: ["https://widget.example.com"],
    now,
    expiresAt: now + 300_000,
  });
  const [h, p, sig] = token.split(".") as [string, string, string];
  assert.deepEqual(b64urlJson(h), { alg: "HS256", typ: "JWT" });
  assert.equal(createHmac("sha256", "private-key-value").update(`${h}.${p}`).digest("base64url"), sig);
  const payload = b64urlJson(p);
  assert.equal(payload.orgId, "vapi-org-1");
  assert.equal(payload.exp, expiresAt / 1000);
  assert.equal(payload.exp - payload.iat, 300);
  assert.deepEqual(payload.token, {
    tag: "public",
    restrictions: { enabled: true, allowedOrigins: ["https://widget.example.com"], allowedAssistantIds: ["asst_1"], allowTransientAssistant: false },
  });
  assert.ok(!token.includes("private-key-value"));
});
await t("JWT: re-issuing for the same reservation keeps the same expiry (window never extends)", async () => {
  const exp = Date.UTC(2026, 10, 2, 12, 5, 0);
  const a = await signVapiPublicToken({ orgId: "o", privateKey: "k", assistantId: "a", allowedOrigins: ["https://x.com"], now: exp - 300_000, expiresAt: exp });
  const b = await signVapiPublicToken({ orgId: "o", privateKey: "k", assistantId: "a", allowedOrigins: ["https://x.com"], now: exp - 100_000, expiresAt: exp });
  assert.equal(a.expiresAt, b.expiresAt);
});
await t("JWT: incomplete, expired or unrestricted inputs are refused", async () => {
  const ok = { orgId: "o", privateKey: "k", assistantId: "a", allowedOrigins: ["https://x.com"], now: 1_000_000_000_000, expiresAt: 1_000_000_300_000 };
  await assert.rejects(signVapiPublicToken({ ...ok, orgId: "" }));
  await assert.rejects(signVapiPublicToken({ ...ok, privateKey: "" }));
  await assert.rejects(signVapiPublicToken({ ...ok, assistantId: "" }));
  await assert.rejects(signVapiPublicToken({ ...ok, allowedOrigins: [] }));
  await assert.rejects(signVapiPublicToken({ ...ok, expiresAt: ok.now })); // already expired
  await assert.rejects(signVapiPublicToken({ ...ok, expiresAt: ok.now + 1_500 })); // not whole seconds
});

// ------------------------------------------------------ webhook auth
await t("webhook auth: only a Bearer token matching the secret passes", async () => {
  assert.equal(extractBearerToken("Bearer abc123"), "abc123");
  assert.equal(extractBearerToken("bearer abc123"), "abc123");
  assert.equal(extractBearerToken("Basic abc123"), null);
  assert.equal(extractBearerToken(null), null);
  assert.equal(extractBearerToken("Bearer "), null);
  assert.equal(await secretsMatch("s3cret", "s3cret"), true);
  assert.equal(await secretsMatch("s3cret", "s3creT"), false);
  assert.equal(await secretsMatch("s3cret", "s3cret-longer"), false);
  assert.equal(await secretsMatch(null, "s3cret"), false);
  assert.equal(await secretsMatch("s3cret", undefined), false); // unset server secret never matches
  assert.equal(await secretsMatch("", ""), false);
});

// ----------------------------------------------------- webhook parsing
const report = (over: Record<string, unknown> = {}, callOver: Record<string, unknown> = {}) => ({
  message: {
    type: "end-of-call-report",
    endedReason: "customer-ended-call",
    call: {
      id: "call_abc-123",
      assistantId: "asst_1",
      startedAt: "2026-11-02T12:00:00.000Z",
      endedAt: "2026-11-02T12:01:30.000Z",
      cost: 0.0725,
      ...callOver,
    },
    artifact: {
      messages: [
        { role: "assistant", message: "Hi" },
        { role: "user", message: "Hello there" },
        { role: "user", message: "   " },
        { role: "user", message: "Thanks" },
      ],
    },
    ...over,
  },
});
const ok = (b: unknown) => {
  const r = parseVapiMessage(b);
  assert.equal(r.kind, "ok", JSON.stringify(r));
  return (r as Extract<ReturnType<typeof parseVapiMessage>, { kind: "ok" }>).report;
};
await t("parse: a real-shaped end-of-call-report yields provider duration, cost, turns", () => {
  const r = ok(report());
  assert.equal(r.providerCallId, "call_abc-123");
  assert.equal(r.assistantId, "asst_1");
  assert.equal(r.durationSeconds, 90);
  assert.equal(r.costMicro, 72_500);
  assert.equal(r.rawCostUsd, 0.0725);
  assert.equal(r.userTurns, 2); // the blank user message is not a turn
  assert.equal(r.overridesDetected, false);
  assert.equal(r.endedReason, "customer-ended-call");
});
await t("parse: other message types are ignored; malformed ones are invalid", () => {
  assert.deepEqual(parseVapiMessage({ message: { type: "status-update" } }), { kind: "ignore" });
  assert.equal(parseVapiMessage(null).kind, "invalid");
  assert.equal(parseVapiMessage([]).kind, "invalid");
  assert.equal(parseVapiMessage({}).kind, "invalid");
  assert.equal(parseVapiMessage({ message: {} }).kind, "invalid");
  assert.equal(parseVapiMessage({ message: { type: "end-of-call-report" } }).kind, "invalid"); // no call
});
await t("parse: call id and assistant id are validated", () => {
  for (const id of [undefined, "", 5, "has space", "a".repeat(101), "bad/id", "x;y"]) {
    assert.equal(parseVapiMessage(report({}, { id })).kind, "invalid", `call id ${String(id)}`);
  }
  for (const assistantId of [undefined, "", 5, "bad id"]) {
    assert.equal(parseVapiMessage(report({}, { assistantId })).kind, "invalid", `assistant ${String(assistantId)}`);
  }
  // falls back to message.assistant.id only when the call has none
  assert.equal(ok(report({ assistant: { id: "asst_fallback" } }, { assistantId: undefined })).assistantId, "asst_fallback");
});
await t("parse: a missing or invalid cost stays UNKNOWN, never zero", () => {
  for (const cost of [undefined, null, "0.5", Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    const r = ok(report({}, { cost }));
    assert.equal(r.costMicro, undefined, `cost ${String(cost)}`);
    assert.equal(r.rawCostUsd, undefined);
  }
  assert.equal(ok(report({}, { cost: 0 })).costMicro, 0); // an explicit reported zero is a real zero
});
await t("parse: duration comes only from provider timestamps and is validated", () => {
  assert.equal(ok(report({}, { startedAt: undefined })).durationSeconds, undefined);
  assert.equal(ok(report({}, { endedAt: "not a date" })).durationSeconds, undefined);
  assert.equal(ok(report({}, { endedAt: "2026-11-02T11:59:00.000Z" })).durationSeconds, undefined); // ends before it starts
  assert.equal(ok(report({}, { endedAt: "2030-01-01T00:00:00.000Z" })).durationSeconds, undefined); // implausibly long
  // message-level timestamps are only a fallback when the call has none
  const fb = ok(report({ startedAt: "2026-11-02T12:00:00Z", endedAt: "2026-11-02T12:00:10Z" }, { startedAt: undefined, endedAt: undefined }));
  assert.equal(fb.durationSeconds, 10);
});
await t("parse: browser-supplied assistant overrides are detected", () => {
  assert.equal(ok(report({}, { assistantOverrides: { maxDurationSeconds: 43_200 } })).overridesDetected, true);
  assert.equal(ok(report({}, { assistantOverrides: {} })).overridesDetected, false);
  assert.equal(ok(report({}, { assistantOverrides: null })).overridesDetected, false);
});
await t("ended reasons: unknown reasons are NOT successes; override is configurable", () => {
  assert.equal(successEndedReasons({}).has("customer-ended-call"), true);
  assert.equal(successEndedReasons({}).has("pipeline-error-openai-llm-failed"), false);
  assert.deepEqual([...successEndedReasons({ VAPI_SUCCESS_ENDED_REASONS: "a, b" })], ["a", "b"]);
});

// ------------------------------------------------------- Polar orders
const order = (over: Record<string, unknown> = {}) => ({
  id: "ord_1",
  status: "paid",
  paid: true,
  currency: "usd",
  net_amount: 5_900,
  tax_amount: 400,
  total_amount: 6_300,
  refunded_amount: 0,
  platform_fee_amount: 250,
  customer: { id: "cus_1", external_id: "org_abc123" },
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});
const okOrder = (type: string, data: unknown) => {
  const r = parsePolarOrderEvent(type, data, 0);
  assert.equal(r.kind, "ok", JSON.stringify(r));
  return (r as Extract<ReturnType<typeof parsePolarOrderEvent>, { kind: "ok" }>).order;
};
await t("polar: net (not total, not tax) is the revenue; cents become micro-dollars", () => {
  const o = okOrder("order.paid", order());
  assert.equal(o.netMicro, 59_000_000);
  assert.equal(o.feeMicro, 2_500_000);
  assert.equal(o.organizationId, "org_abc123");
});
await t("polar: a missing platform fee stays undefined, never zero", () => {
  assert.equal(okOrder("order.paid", order({ platform_fee_amount: undefined })).feeMicro, undefined);
});
await t("polar: unlinked, unsupported and invalid events", () => {
  assert.equal(parsePolarOrderEvent("subscription.updated", order(), 0).kind, "ignore");
  assert.equal(parsePolarOrderEvent("order.paid", order({ customer: { id: "c" } }), 0).kind, "unlinked");
  assert.equal(parsePolarOrderEvent("order.paid", order({ customer: { external_id: "evil" } }), 0).kind, "unlinked");
  assert.equal(parsePolarOrderEvent("order.paid", order({ currency: "eur" }), 0).kind, "invalid"); // no guessing at FX
  assert.equal(parsePolarOrderEvent("order.paid", order({ status: "pending", paid: false }), 0).kind, "invalid");
  assert.equal(parsePolarOrderEvent("order.paid", order({ net_amount: -5 }), 0).kind, "invalid");
  assert.equal(parsePolarOrderEvent("order.paid", order({ net_amount: 59.5 }), 0).kind, "invalid");
  assert.equal(parsePolarOrderEvent("order.paid", order({ id: " ord_1 " }), 0).kind, "invalid");
  assert.equal(parsePolarOrderEvent("order.paid", null, 0).kind, "invalid");
  assert.equal(parsePolarOrderEvent("order.refunded", order({ status: "paid" }), 0).kind, "invalid");
});
await t("polar: metadata can never name the organization (only customer.external_id)", () => {
  assert.equal(parsePolarOrderEvent("order.paid", order({ customer: { id: "c" }, metadata: { organizationId: "org_victim1" } }), 0).kind, "unlinked");
});
await t("polar: refunds are cumulative and tax-free amounts in micro-dollars", () => {
  const o = okOrder("order.refunded", order({ status: "partially_refunded", refunded_amount: 1_000 }));
  assert.equal(o.refundedTotalMicro, 10_000_000);
});

// --------------------------------------------------------- accounting
await t("accounting: contribution = net collected - KNOWN vapi expense; reserved funds are not earnings", () => {
  const a = computeOrgAccounting({
    entries: [
      { kind: "payment", amountMicro: 59_000_000 },
      { kind: "platform_fee", amountMicro: 2_500_000 },
    ],
    usage: [
      { costStatus: "known", costMicro: 4_000_000, customerChargeMicro: 4_000_000 },
      { costStatus: "known", costMicro: 1_500_000, customerChargeMicro: 1_500_000 },
    ],
  });
  assert.equal(a.netCollectedMicro, 56_500_000);
  assert.equal(a.vapiExpenseKnownMicro, 5_500_000);
  assert.equal(a.contributionMicro, 51_000_000);
  assert.equal(a.provisional, false);
  assert.equal(a.platformFeesReported, true);
  assert.equal(a.allocation.vapiReserve! + a.allocation.infrastructureReserve! + a.allocation.operating!, a.netCollectedMicro);
});
await t("accounting: pending costs make the result provisional and are never valued as zero", () => {
  const a = computeOrgAccounting({
    entries: [{ kind: "payment", amountMicro: 59_000_000 }],
    usage: [{ costStatus: "known", costMicro: 1_000_000 }, { costStatus: "pending" }],
  });
  assert.equal(a.pendingCostCalls, 1);
  assert.equal(a.provisional, true);
  assert.equal(a.vapiExpenseKnownMicro, 1_000_000); // the pending call adds nothing, and is flagged
  assert.equal(a.callCount, 2);
});
await t("accounting: refunds reduce net, and a negative net never produces a negative allocation", () => {
  const a = computeOrgAccounting({
    entries: [{ kind: "payment", amountMicro: 10_000_000 }, { kind: "refund", amountMicro: 12_000_000 }],
    usage: [],
  });
  assert.equal(a.netCollectedMicro, -2_000_000);
  assert.deepEqual(a.allocation, { vapiReserve: 0, infrastructureReserve: 0, operating: 0 });
  assert.equal(a.platformFeesReported, false); // not reported is not the same as zero
});

// ------------------------------------------------------- platform admin
await t("platform admin: fail closed on empty or unset list; exact user-ID match only", () => {
  assert.equal(isPlatformAdmin("user_1", {}), false);
  assert.equal(isPlatformAdmin("user_1", { PLATFORM_ADMIN_USER_IDS: "" }), false);
  assert.equal(isPlatformAdmin("user_1", { PLATFORM_ADMIN_USER_IDS: " , ," }), false);
  assert.equal(isPlatformAdmin("user_1", { PLATFORM_ADMIN_USER_IDS: "user_1, user_2" }), true);
  assert.equal(isPlatformAdmin("user_2", { PLATFORM_ADMIN_USER_IDS: "user_1, user_2" }), true);
  assert.equal(isPlatformAdmin("user_", { PLATFORM_ADMIN_USER_IDS: "user_1" }), false); // no prefix matching
  assert.equal(isPlatformAdmin("USER_1", { PLATFORM_ADMIN_USER_IDS: "user_1" }), false); // case-sensitive
  assert.equal(isPlatformAdmin(undefined, { PLATFORM_ADMIN_USER_IDS: "user_1" }), false);
  assert.equal(isPlatformAdmin("", { PLATFORM_ADMIN_USER_IDS: "user_1" }), false);
  assert.equal(platformAdminIds({ PLATFORM_ADMIN_USER_IDS: "a,b,a" }).size, 2);
});

console.log(`${n} passed`);
