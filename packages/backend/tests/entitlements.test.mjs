import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../convex/lib/entitlements.ts", import.meta.url);
const source = readFileSync(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const exports = {};
runInNewContext(compiled, { exports });

const { calendarMonth, limitError, resolveEntitlements, PAST_DUE_GRACE_MS, STALE_PERIOD_GRACE_MS } = exports;
const day = 24 * 60 * 60 * 1000;

test("calendarMonth uses UTC boundaries, including year rollover", () => {
  const now = Date.UTC(2026, 11, 15, 12);
  const period = calendarMonth(now);

  assert.equal(period.start, Date.UTC(2026, 11, 1));
  assert.equal(period.end, Date.UTC(2027, 0, 1));
});

test("missing subscription resolves to Free for the current UTC month", () => {
  const now = Date.UTC(2026, 9, 31, 20);
  const result = resolveEntitlements(null, now);

  assert.equal(result.plan, "free");
  assert.equal(result.status, "none");
  assert.equal(result.limits.aiMessages, 100);
  assert.equal(result.periodStart, Date.UTC(2026, 9, 1));
  assert.equal(result.periodEnd, Date.UTC(2026, 10, 1));
});

test("active paid subscription receives its configured plan limits", () => {
  const now = Date.UTC(2026, 9, 10);
  const result = resolveEntitlements({
    plan: "pro",
    status: "active",
    currentPeriodStart: Date.UTC(2026, 9, 1),
    currentPeriodEnd: Date.UTC(2026, 10, 1),
  }, now);

  assert.equal(result.plan, "pro");
  assert.equal(result.limits.aiMessages, 2000);
  assert.equal(result.limits.knowledgeFiles, 100);
  assert.equal(result.limits.voice, true);
});

test("cancel-at-period-end does not remove access before the period ends", () => {
  const now = Date.UTC(2026, 9, 20);
  const result = resolveEntitlements({
    plan: "enterprise",
    status: "active",
    currentPeriodStart: Date.UTC(2026, 9, 1),
    currentPeriodEnd: Date.UTC(2026, 10, 1),
    cancelAtPeriodEnd: true,
  }, now);

  assert.equal(result.plan, "enterprise");
  assert.equal(result.cancelAtPeriodEnd, true);
});

test("past-due subscription retains access inside the grace period", () => {
  const now = Date.UTC(2026, 9, 10);
  const result = resolveEntitlements({
    plan: "pro",
    status: "past_due",
    currentPeriodStart: Date.UTC(2026, 9, 1),
    currentPeriodEnd: Date.UTC(2026, 10, 1),
    pastDueSince: now - day,
  }, now);

  assert.equal(result.plan, "pro");
  assert.equal(result.pastDue, true);
  assert.equal(result.graceEndsAt, now - day + PAST_DUE_GRACE_MS);
});

test("past-due subscription loses paid access at the exact grace boundary", () => {
  const pastDueSince = Date.UTC(2026, 9, 1);
  const now = pastDueSince + PAST_DUE_GRACE_MS;
  const result = resolveEntitlements({
    plan: "pro",
    status: "past_due",
    currentPeriodStart: Date.UTC(2026, 8, 1),
    currentPeriodEnd: Date.UTC(2026, 10, 1),
    pastDueSince,
  }, now);

  assert.equal(result.plan, "free");
  assert.equal(result.pastDue, true);
});

test("stale paid subscription data falls back to Free", () => {
  const currentPeriodEnd = Date.UTC(2026, 8, 1);
  const now = currentPeriodEnd + STALE_PERIOD_GRACE_MS + 1;
  const result = resolveEntitlements({
    plan: "enterprise",
    status: "active",
    currentPeriodStart: Date.UTC(2026, 7, 1),
    currentPeriodEnd,
  }, now);

  assert.equal(result.plan, "free");
  assert.equal(result.status, "stale");
});

test("unknown plans and unverified statuses never grant paid access", () => {
  const period = {
    currentPeriodStart: Date.UTC(2026, 9, 1),
    currentPeriodEnd: Date.UTC(2026, 10, 1),
  };
  const unknownPlan = resolveEntitlements({ ...period, plan: "business", status: "active" }, Date.UTC(2026, 9, 10));
  const unknownStatus = resolveEntitlements({ ...period, plan: "pro", status: "pending" }, Date.UTC(2026, 9, 10));

  assert.equal(unknownPlan.plan, "free");
  assert.equal(unknownStatus.plan, "free");
});

test("limitError returns a stable machine-readable limit payload", () => {
  const resetsAt = Date.UTC(2026, 10, 1);
  const result = limitError("AI messages", 100, 100, resetsAt);

  assert.equal(result.code, "LIMIT_REACHED");
  assert.equal(result.metric, "AI messages");
  assert.equal(result.used, 100);
  assert.equal(result.limit, 100);
  assert.equal(result.resetsAt, resetsAt);
  assert.match(result.message, /2026-11-01/);
});
