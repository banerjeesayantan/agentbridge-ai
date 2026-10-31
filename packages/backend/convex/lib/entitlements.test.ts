import { describe, expect, it } from "vitest";
import {
  PAST_DUE_GRACE_MS,
  PERIOD_START_SKEW_MS,
  PLANS,
  STALE_PERIOD_GRACE_MS,
  calendarMonth,
  resolveEntitlements,
  type SubscriptionLike,
} from "./entitlements";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0); // 2026-10-30 12:00 UTC

/** A healthy Pro subscription mid-period; override per test. */
const sub = (overrides: Partial<SubscriptionLike> = {}): SubscriptionLike => ({
  plan: "pro",
  status: "active",
  currentPeriodStart: NOW - 10 * DAY,
  currentPeriodEnd: NOW + 20 * DAY,
  ...overrides,
});

describe("resolveEntitlements: paid access", () => {
  it("grants Pro to an active subscription", () => {
    const r = resolveEntitlements(sub(), NOW);
    expect(r.plan).toBe("pro");
    expect(r.planName).toBe("Pro");
    expect(r.limits).toEqual(PLANS.pro.limits);
    expect(r.periodStart).toBe(NOW - 10 * DAY);
    expect(r.periodEnd).toBe(NOW + 20 * DAY);
    expect(r.pastDue).toBe(false);
    expect(r.graceEndsAt).toBeNull();
  });

  it("grants Business limits to an active Business subscription", () => {
    const r = resolveEntitlements(sub({ plan: "business" }), NOW);
    expect(r.plan).toBe("business");
    expect(r.limits).toEqual(PLANS.business.limits);
  });

  it("grants paid access to a trialing subscription", () => {
    const r = resolveEntitlements(sub({ status: "trialing" }), NOW);
    expect(r.plan).toBe("pro");
    expect(r.status).toBe("trialing");
  });
});

describe("resolveEntitlements: past_due grace", () => {
  it("keeps paid access within the seven-day grace window", () => {
    const pastDueSince = NOW - 3 * DAY;
    const r = resolveEntitlements(sub({ status: "past_due", pastDueSince }), NOW);
    expect(r.plan).toBe("pro");
    expect(r.pastDue).toBe(true);
    expect(r.graceEndsAt).toBe(pastDueSince + PAST_DUE_GRACE_MS);
  });

  it("is still paid one millisecond before the grace deadline", () => {
    const pastDueSince = NOW - PAST_DUE_GRACE_MS + 1;
    const r = resolveEntitlements(sub({ status: "past_due", pastDueSince }), NOW);
    expect(r.plan).toBe("pro");
  });

  it("falls to Free exactly at the grace deadline", () => {
    const pastDueSince = NOW - PAST_DUE_GRACE_MS;
    const r = resolveEntitlements(sub({ status: "past_due", pastDueSince }), NOW);
    expect(r.plan).toBe("free");
    expect(r.pastDue).toBe(true);
    expect(r.graceEndsAt).toBe(NOW);
  });

  it("is not shortened by the three-day stale-period buffer", () => {
    // Period ended 5 days ago, payment failed 2 days ago: still inside grace.
    const r = resolveEntitlements(
      sub({
        status: "past_due",
        currentPeriodStart: NOW - 35 * DAY,
        currentPeriodEnd: NOW - 5 * DAY,
        pastDueSince: NOW - 2 * DAY,
      }),
      NOW,
    );
    expect(r.plan).toBe("pro");
  });

  it("does not move the deadline when called later with the same record", () => {
    const record = sub({ status: "past_due", pastDueSince: NOW - 2 * DAY });
    const a = resolveEntitlements(record, NOW);
    const b = resolveEntitlements(record, NOW + DAY);
    expect(b.graceEndsAt).toBe(a.graceEndsAt);
  });

  it.each([
    ["missing", undefined],
    ["in the future", NOW + 1],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("fails closed when pastDueSince is %s", (_label, pastDueSince) => {
    const r = resolveEntitlements(sub({ status: "past_due", pastDueSince }), NOW);
    expect(r.plan).toBe("free");
    expect(r.pastDue).toBe(true);
    expect(r.graceEndsAt).toBeNull();
  });
});

describe("resolveEntitlements: scheduled cancellation", () => {
  it("stays paid before the period end and reports the cancellation", () => {
    const r = resolveEntitlements(
      sub({ cancelAtPeriodEnd: true, currentPeriodEnd: NOW + 1 }),
      NOW,
    );
    expect(r.plan).toBe("pro");
    expect(r.cancelAtPeriodEnd).toBe(true);
  });

  it("becomes Free exactly at the period end", () => {
    const r = resolveEntitlements(
      sub({ cancelAtPeriodEnd: true, currentPeriodEnd: NOW }),
      NOW,
    );
    expect(r.plan).toBe("free");
    expect(r.status).toBe("canceled");
  });

  it("becomes Free after the period end", () => {
    const r = resolveEntitlements(
      sub({ cancelAtPeriodEnd: true, currentPeriodEnd: NOW - DAY }),
      NOW,
    );
    expect(r.plan).toBe("free");
  });

  it("takes precedence over an open past_due grace window", () => {
    const r = resolveEntitlements(
      sub({
        status: "past_due",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: NOW - DAY,
        pastDueSince: NOW - DAY,
      }),
      NOW,
    );
    expect(r.plan).toBe("free");
  });
});

describe("resolveEntitlements: stale data", () => {
  it("is still paid exactly at the stale buffer boundary", () => {
    const r = resolveEntitlements(
      sub({ currentPeriodEnd: NOW - STALE_PERIOD_GRACE_MS }),
      NOW,
    );
    expect(r.plan).toBe("pro");
  });

  it("falls to Free one millisecond past the stale buffer", () => {
    const r = resolveEntitlements(
      sub({ currentPeriodEnd: NOW - STALE_PERIOD_GRACE_MS - 1 }),
      NOW,
    );
    expect(r.plan).toBe("free");
    expect(r.status).toBe("stale");
  });

  it("applies to trialing subscriptions too", () => {
    const r = resolveEntitlements(
      sub({ status: "trialing", currentPeriodEnd: NOW - 4 * DAY }),
      NOW,
    );
    expect(r.plan).toBe("free");
    expect(r.status).toBe("stale");
  });
});

describe("resolveEntitlements: fail-closed inputs", () => {
  it.each(["canceled", "revoked", "unpaid", "incomplete", "something_new"])(
    "does not grant paid access for status %s",
    (status) => {
      const r = resolveEntitlements(sub({ status }), NOW);
      expect(r.plan).toBe("free");
      expect(r.status).toBe(status);
    },
  );

  it("resolves a missing subscription to Free with status none", () => {
    expect(resolveEntitlements(null, NOW)).toMatchObject({ plan: "free", status: "none" });
    expect(resolveEntitlements(undefined, NOW)).toMatchObject({ plan: "free", status: "none" });
  });

  it("resolves an unknown plan to Free even when active", () => {
    const r = resolveEntitlements(sub({ plan: "enterprise" }), NOW);
    expect(r.plan).toBe("free");
    expect(r.status).toBe("active");
  });

  it.each([
    ["start missing", { currentPeriodStart: undefined }],
    ["end missing", { currentPeriodEnd: undefined }],
    ["start NaN", { currentPeriodStart: Number.NaN }],
    ["end Infinity", { currentPeriodEnd: Number.POSITIVE_INFINITY }],
    ["start equals end", { currentPeriodStart: NOW, currentPeriodEnd: NOW }],
    ["start after end", { currentPeriodStart: NOW + DAY, currentPeriodEnd: NOW }],
  ] as const)("resolves to Free when the billing period is invalid (%s)", (_label, patch) => {
    const r = resolveEntitlements(sub(patch), NOW);
    expect(r.plan).toBe("free");
  });
});

describe("resolveEntitlements: period not yet started", () => {
  it("does not grant paid access before the billing period starts", () => {
    const r = resolveEntitlements(sub({ currentPeriodStart: NOW + DAY }), NOW);
    expect(r.plan).toBe("free");
    expect(r.status).toBe("active");
  });

  it("tolerates a small clock skew right after a period starts", () => {
    const r = resolveEntitlements(
      sub({ currentPeriodStart: NOW + PERIOD_START_SKEW_MS }),
      NOW,
    );
    expect(r.plan).toBe("pro");
  });

  it("falls to Free one millisecond beyond the skew tolerance", () => {
    const r = resolveEntitlements(
      sub({ currentPeriodStart: NOW + PERIOD_START_SKEW_MS + 1 }),
      NOW,
    );
    expect(r.plan).toBe("free");
  });

  it("applies to past_due subscriptions too", () => {
    const r = resolveEntitlements(
      sub({
        status: "past_due",
        pastDueSince: NOW - DAY,
        currentPeriodStart: NOW + DAY,
      }),
      NOW,
    );
    expect(r.plan).toBe("free");
  });
});

describe("Free plan usage period", () => {
  it("uses the UTC calendar month", () => {
    const r = resolveEntitlements(null, NOW);
    const { start, end } = calendarMonth(NOW);
    expect(r.periodStart).toBe(Date.UTC(2026, 9, 1));
    expect(r.periodEnd).toBe(Date.UTC(2026, 10, 1));
    expect([r.periodStart, r.periodEnd]).toEqual([start, end]);
  });

  it("rolls over correctly in December", () => {
    const { start, end } = calendarMonth(Date.UTC(2026, 11, 15));
    expect(start).toBe(Date.UTC(2026, 11, 1));
    expect(end).toBe(Date.UTC(2027, 0, 1));
  });
});