import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A valid mapped event; override per test. */
const event = (over: Record<string, unknown> = {}) => ({
  eventId: "evt_1",
  type: "subscription.updated",
  organizationId: "org_A",
  polarSubscriptionId: "sub_A",
  polarCustomerId: "cus_A",
  polarProductId: "prod_pro",
  plan: "pro" as const,
  status: "active",
  currentPeriodStart: NOW - 10 * DAY,
  currentPeriodEnd: NOW + 20 * DAY,
  cancelAtPeriodEnd: false,
  modifiedAt: NOW - DAY,
  ...over,
});

const apply = (t: ReturnType<typeof convexTest>, over: Record<string, unknown> = {}) =>
  t.mutation(internal.system.subscriptions.applyPolarEvent, event(over) as never);

const rows = (t: ReturnType<typeof convexTest>, table: string) =>
  t.run(async (ctx) => ctx.db.query(table as never).collect() as Promise<any[]>);

describe("normal creation and updates", () => {
  it("creates a subscription for a new organization", async () => {
    const t = convexTest(schema, modules);
    const r = await apply(t);
    expect(r).toMatchObject({ applied: true, plan: "pro" });
    const subs = await rows(t, "subscriptions");
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ organizationId: "org_A", polarSubscriptionId: "sub_A" });
  });

  it("updates the same subscription for the same organization", async () => {
    const t = convexTest(schema, modules);
    await apply(t);
    const r = await apply(t, { eventId: "evt_2", status: "past_due", modifiedAt: NOW });
    expect(r).toMatchObject({ applied: true });
    const subs = await rows(t, "subscriptions");
    expect(subs).toHaveLength(1);
    expect(subs[0].status).toBe("past_due");
  });

  it("ignores an older event for the same subscription", async () => {
    const t = convexTest(schema, modules);
    await apply(t, { modifiedAt: NOW });
    const r = await apply(t, { eventId: "evt_2", status: "canceled", modifiedAt: NOW - DAY });
    expect(r).toEqual({ applied: false, reason: "stale" });
    expect((await rows(t, "subscriptions"))[0].status).toBe("active");
  });
});

describe("duplicate events", () => {
  it("applies a webhook-id once and ignores the redelivery", async () => {
    const t = convexTest(schema, modules);
    await apply(t);
    const again = await apply(t);
    expect(again).toEqual({ applied: false, reason: "duplicate" });
    expect(await rows(t, "subscriptions")).toHaveLength(1);
    expect(await rows(t, "webhookEvents")).toHaveLength(1);
  });
});

describe("cross-organization conflicts", () => {
  it("rejects a subscription ID owned by another organization", async () => {
    const t = convexTest(schema, modules);
    await apply(t); // org_A owns sub_A

    const r = await apply(t, { eventId: "evt_x", organizationId: "org_B" });
    expect(r).toEqual({ applied: false, reason: "wrong-organization" });

    const subs = await rows(t, "subscriptions");
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ organizationId: "org_A", polarSubscriptionId: "sub_A", status: "active" });
  });

  it("records one deduplicated wrong-organization failure and does not mark the event processed", async () => {
    const t = convexTest(schema, modules);
    await apply(t);

    await apply(t, { eventId: "evt_x", organizationId: "org_B" });
    await apply(t, { eventId: "evt_x", organizationId: "org_B" }); // redelivery

    const failures = await rows(t, "webhookFailures");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      eventId: "evt_x",
      reason: "wrong-organization",
      organizationId: "org_B",
      polarSubscriptionId: "sub_A",
      status: "open",
    });

    const processed = (await rows(t, "webhookEvents")).map((e) => e.eventId);
    expect(processed).not.toContain("evt_x");
  });

  it("rejects a superseded subscription ID arriving under another organization", async () => {
    const t = convexTest(schema, modules);
    // org_A: sub_A loses access, then sub_B replaces it, superseding sub_A.
    await apply(t, { eventId: "evt_1", status: "revoked", modifiedAt: NOW - 3 * DAY });
    await apply(t, {
      eventId: "evt_2",
      polarSubscriptionId: "sub_B",
      modifiedAt: NOW - 2 * DAY,
    });
    expect(await rows(t, "supersededSubscriptions")).toHaveLength(1);

    const r = await apply(t, { eventId: "evt_3", organizationId: "org_B", polarSubscriptionId: "sub_A" });
    expect(r).toEqual({ applied: false, reason: "wrong-organization" });
    expect(await rows(t, "subscriptions")).toHaveLength(1);
    expect((await rows(t, "webhookFailures"))[0]).toMatchObject({ polarSubscriptionId: "sub_A" });
  });

  it("still ignores a superseded subscription under its original organization", async () => {
    const t = convexTest(schema, modules);
    await apply(t, { eventId: "evt_1", status: "revoked", modifiedAt: NOW - 3 * DAY });
    await apply(t, { eventId: "evt_2", polarSubscriptionId: "sub_B", modifiedAt: NOW - 2 * DAY });

    const r = await apply(t, { eventId: "evt_3", polarSubscriptionId: "sub_A", modifiedAt: NOW });
    expect(r).toEqual({ applied: false, reason: "superseded" });
    expect(await rows(t, "webhookFailures")).toHaveLength(0);
  });
});

describe("preserved replacement behavior", () => {
  it("rejects a different subscription while the current one is paid, without recording it", async () => {
    const t = convexTest(schema, modules);
    await apply(t);
    const r = await apply(t, { eventId: "evt_2", polarSubscriptionId: "sub_B" });
    expect(r).toEqual({ applied: false, reason: "other-subscription" });
    expect((await rows(t, "webhookEvents")).map((e) => e.eventId)).not.toContain("evt_2");
    expect(await rows(t, "webhookFailures")).toHaveLength(0);
  });

  it("lets a new subscription replace one that lost access and records the old one as superseded", async () => {
    const t = convexTest(schema, modules);
    await apply(t, { eventId: "evt_1", status: "revoked", modifiedAt: NOW - 3 * DAY });
    const r = await apply(t, { eventId: "evt_2", polarSubscriptionId: "sub_B", modifiedAt: NOW - 2 * DAY });
    expect(r).toMatchObject({ applied: true });
    const sup = await rows(t, "supersededSubscriptions");
    expect(sup).toHaveLength(1);
    expect(sup[0]).toMatchObject({ organizationId: "org_A", polarSubscriptionId: "sub_A" });
  });
});

describe("legacy upsert", () => {
  it("refuses to overwrite a Polar-managed subscription", async () => {
    const t = convexTest(schema, modules);
    await apply(t);
    const r = await t.mutation(internal.system.subscriptions.upsert, {
      organizationId: "org_A",
      status: "canceled",
    });
    expect(r).toEqual({ applied: false, reason: "polar-managed" });
    expect((await rows(t, "subscriptions"))[0].status).toBe("active");
  });

  it("still creates and updates rows that are not Polar-managed", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.system.subscriptions.upsert, { organizationId: "org_L", status: "active" });
    const r = await t.mutation(internal.system.subscriptions.upsert, { organizationId: "org_L", status: "canceled" });
    expect(r).toEqual({ applied: true });
    const subs = await rows(t, "subscriptions");
    expect(subs).toHaveLength(1);
    expect(subs[0].status).toBe("canceled");
  });
});