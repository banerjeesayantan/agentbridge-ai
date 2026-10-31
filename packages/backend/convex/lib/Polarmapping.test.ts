import { describe, expect, it, vi } from "vitest";

vi.mock("./polarConfig", () => ({
  planForProductId: (id?: string) =>
    id === "prod_pro" ? "pro" : id === "prod_biz" ? "business" : undefined,
}));

import { mapSubscriptionEvent } from "./polarMapping";

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

/** A valid raw (snake_case) Polar subscription payload; override per test. */
const payload = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  customer_id: "cus_1",
  customer: { id: "cus_1", external_id: "org_abc123" },
  product_id: "prod_pro",
  prices: [{ id: "price_1" }],
  recurring_interval: "month",
  current_period_start: "2026-10-01T00:00:00Z",
  current_period_end: "2026-11-01T00:00:00Z",
  cancel_at_period_end: false,
  modified_at: "2026-10-29T10:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});

const map = (data: unknown, type = "subscription.updated", eventId = "evt_1") =>
  mapSubscriptionEvent(type, data, eventId, NOW);

describe("mapping a valid event", () => {
  it("maps a raw snake_case payload", () => {
    expect(map(payload())).toEqual({
      eventId: "evt_1",
      organizationId: "org_abc123",
      polarSubscriptionId: "sub_1",
      polarCustomerId: "cus_1",
      polarProductId: "prod_pro",
      polarPriceId: "price_1",
      plan: "pro",
      status: "active",
      interval: "month",
      currentPeriodStart: Date.UTC(2026, 9, 1),
      currentPeriodEnd: Date.UTC(2026, 10, 1),
      cancelAtPeriodEnd: false,
      modifiedAt: Date.UTC(2026, 9, 29, 10),
    });
  });

  it("maps an SDK camelCase payload with Date objects", () => {
    const r = map({
      id: "sub_1",
      status: "trialing",
      customerId: "cus_1",
      customer: { id: "cus_1", externalId: "org_abc123" },
      productId: "prod_biz",
      currentPeriodStart: new Date(Date.UTC(2026, 9, 1)),
      currentPeriodEnd: new Date(Date.UTC(2026, 10, 1)),
      cancelAtPeriodEnd: true,
      modifiedAt: new Date(Date.UTC(2026, 9, 29)),
    });
    expect(r).toMatchObject({
      organizationId: "org_abc123",
      plan: "business",
      status: "trialing",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: Date.UTC(2026, 10, 1),
    });
  });

  it("forces status revoked for subscription.revoked", () => {
    expect(map(payload({ status: "active" }), "subscription.revoked")?.status).toBe("revoked");
  });
});

describe("organization trust", () => {
  it("rejects an event whose only organization hint is metadata", () => {
    const data = payload({
      customer: { id: "cus_1", metadata: { organizationId: "org_victim1" } },
      metadata: { organizationId: "org_victim1" },
    });
    expect(map(data)).toBeNull();
  });

  it("ignores conflicting metadata and uses the customer's external id", () => {
    const data = payload({ metadata: { organizationId: "org_victim1" } });
    expect(map(data)?.organizationId).toBe("org_abc123");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not an org id", "evil"],
    ["prefix only", "org_"],
    ["whitespace", "org_abc 123"],
    ["injection-like", "org_abc'; drop"],
    ["too long", `org_${"a".repeat(129)}`],
    ["a number", 12345],
  ])("rejects an external id that is %s", (_label, externalId) => {
    expect(map(payload({ customer: { id: "cus_1", external_id: externalId } }))).toBeNull();
  });

  it("rejects a missing customer object", () => {
    expect(map(payload({ customer: undefined }))).toBeNull();
    expect(map(payload({ customer: null }))).toBeNull();
  });
});

describe("identifier validation", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["a number", 42],
    ["padded with spaces", " sub_1 "],
    ["too long", "s".repeat(201)],
  ])("rejects a subscription id that is %s", (_label, id) => {
    expect(map(payload({ id }))).toBeNull();
  });

  it("rejects a missing or invalid customer id", () => {
    expect(map(payload({ customer_id: undefined, customer: { external_id: "org_abc123" } }))).toBeNull();
    expect(map(payload({ customer_id: 7 }))).toBeNull();
  });

  it("rejects an empty event id", () => {
    expect(map(payload(), "subscription.updated", "")).toBeNull();
  });

  it("rejects non-subscription events and non-object payloads", () => {
    expect(map(payload(), "order.created")).toBeNull();
    expect(map(null)).toBeNull();
    expect(map("nope")).toBeNull();
    expect(map([payload()])).toBeNull();
  });
});

describe("product handling", () => {
  it("applies an unknown product with no plan instead of dropping the event", () => {
    const r = map(payload({ product_id: "prod_other" }));
    expect(r).not.toBeNull();
    expect(r?.plan).toBeUndefined();
    expect(r?.polarProductId).toBe("prod_other");
  });

  it("drops a malformed product id and leaves the plan unset", () => {
    const r = map(payload({ product_id: 123 }));
    expect(r?.polarProductId).toBeUndefined();
    expect(r?.plan).toBeUndefined();
  });
});

describe("timestamp validation", () => {
  it("accepts plausible millisecond numbers", () => {
    const r = map(
      payload({
        current_period_start: Date.UTC(2026, 9, 1),
        current_period_end: Date.UTC(2026, 10, 1),
      }),
    );
    expect(r?.currentPeriodStart).toBe(Date.UTC(2026, 9, 1));
  });

  it("rejects numeric timestamps in seconds instead of misreading them", () => {
    const r = map(
      payload({
        current_period_start: Date.UTC(2026, 9, 1) / 1000,
        current_period_end: Date.UTC(2026, 10, 1) / 1000,
      }),
    );
    expect(r?.currentPeriodStart).toBeUndefined();
    expect(r?.currentPeriodEnd).toBeUndefined();
  });

  it.each([
    ["an invalid string", "not-a-date"],
    ["the epoch", 0],
    ["a negative number", -1],
    ["NaN", Number.NaN],
    ["a far-future year", "2500-01-01T00:00:00Z"],
  ])("clears the whole period when a bound is %s", (_label, bad) => {
    const r = map(payload({ current_period_end: bad }));
    expect(r?.currentPeriodStart).toBeUndefined();
    expect(r?.currentPeriodEnd).toBeUndefined();
  });

  it("clears an inverted period", () => {
    const r = map(
      payload({
        current_period_start: "2026-11-01T00:00:00Z",
        current_period_end: "2026-10-01T00:00:00Z",
      }),
    );
    expect(r?.currentPeriodStart).toBeUndefined();
    expect(r?.currentPeriodEnd).toBeUndefined();
  });

  it("falls back to created_at when modified_at is null", () => {
    expect(map(payload({ modified_at: null }))?.modifiedAt).toBe(Date.UTC(2026, 9, 1));
  });

  it("rejects an event with no usable modified or created time", () => {
    expect(map(payload({ modified_at: null, created_at: null }))).toBeNull();
    expect(map(payload({ modified_at: "garbage", created_at: undefined }))).toBeNull();
  });

  it("does NOT fall back to created_at when modified_at is present but invalid", () => {
    expect(map(payload({ modified_at: "garbage" }))).toBeNull();
    expect(map(payload({ modified_at: 1_700_000_000 }))).toBeNull(); // seconds
  });

  it("prefers modified_at over created_at when both are valid", () => {
    expect(map(payload())?.modifiedAt).toBe(Date.UTC(2026, 9, 29, 10));
  });

  it("rejects a modified time far in the future, which would block later events", () => {
    expect(map(payload({ modified_at: "2026-10-31T00:00:00Z" }))).toBeNull();
  });

  it("accepts a modified time within the clock-skew allowance", () => {
    const soon = new Date(NOW + 60_000).toISOString();
    expect(map(payload({ modified_at: soon }))?.modifiedAt).toBe(NOW + 60_000);
  });
});

describe("cancelAtPeriodEnd", () => {
  it("passes real booleans through", () => {
    expect(map(payload({ cancel_at_period_end: true }))?.cancelAtPeriodEnd).toBe(true);
    expect(map(payload({ cancel_at_period_end: false }))?.cancelAtPeriodEnd).toBe(false);
  });

  it.each([
    ["the string 'false'", "false"],
    ["the string 'true'", "true"],
    ["the number 0", 0],
    ["the number 1", 1],
    ["null", null],
    ["missing", undefined],
  ])("rejects the event when it is %s", (_label, value) => {
    expect(map(payload({ cancel_at_period_end: value }))).toBeNull();
  });
});

describe("event type allowlist", () => {
  it.each([
    "subscription.created",
    "subscription.updated",
    "subscription.active",
    "subscription.canceled",
    "subscription.uncanceled",
    "subscription.past_due",
    "subscription.revoked",
  ])("accepts %s", (type) => {
    expect(map(payload(), type)).not.toBeNull();
  });

  it.each([
    "subscription.cycled",
    "subscription.something_new",
    "subscription.",
    "Subscription.updated",
    "order.paid",
    "customer.updated",
    "",
  ])("ignores %s", (type) => {
    expect(map(payload(), type)).toBeNull();
  });
});

describe("status handling", () => {
  it("uses 'unknown' for a missing or non-string status", () => {
    expect(map(payload({ status: undefined }))?.status).toBe("unknown");
    expect(map(payload({ status: 5 }))?.status).toBe("unknown");
  });

  it("uses 'unknown' for an overlong status", () => {
    expect(map(payload({ status: "x".repeat(65) }))?.status).toBe("unknown");
  });
});
