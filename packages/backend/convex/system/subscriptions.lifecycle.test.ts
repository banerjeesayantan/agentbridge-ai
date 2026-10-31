import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";


const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);

let seq = 0;
const baseEvent = (over: Record<string, unknown> = {}) => ({
  eventId: `evt_${++seq}`,
  type: "subscription.updated",
  organizationId: "org_A",
  polarSubscriptionId: "sub_1",
  polarCustomerId: "cus_1",
  plan: "pro" as const,
  status: "active",
  currentPeriodStart: T0 - DAY,
  currentPeriodEnd: T0 + 29 * DAY,
  cancelAtPeriodEnd: false,
  modifiedAt: T0,
  ...over,
});

type T = ReturnType<typeof convexTest>;

const apply = (t: T, over: Record<string, unknown> = {}) =>
  t.mutation(internal.system.subscriptions.applyPolarEvent, baseEvent(over));

const table = (t: T, name: string) =>
  t.run(async (ctx) => (await ctx.db.query(name as never).collect()) as any[]);

const rowsFor = async (t: T, organizationId: string) =>
  (await table(t, "subscriptions")).filter((r) => r.organizationId === organizationId);

const recordedEventIds = async (t: T) =>
  (await table(t, "webhookEvents")).map((e) => e.eventId as string);

const supersededIds = async (t: T, organizationId: string) =>
  (await table(t, "supersededSubscriptions"))
    .filter((r) => r.organizationId === organizationId)
    .map((r) => r.polarSubscriptionId as string);

beforeEach(() => {
  // Fake only Date so the mutation's Date.now() is deterministic.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("applyPolarEvent: ownership guard", () => {
  it("applies a new subscription ID for a new organization", async () => {
    const t = convexTest(schema, modules);
    const r = await apply(t);
    expect(r).toMatchObject({ applied: true, plan: "pro", memberCap: 5 });

    const rows = await rowsFor(t, "org_A");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ polarSubscriptionId: "sub_1", plan: "pro", status: "active" });
  });

  it("applies a newer event for the same subscription and organization", async () => {
    const t = convexTest(schema, modules);
    await apply(t, { modifiedAt: T0 });
    const r = await apply(t, { modifiedAt: T0 + 1000, cancelAtPeriodEnd: true });
    expect(r).toMatchObject({ applied: true });

    const rows = await rowsFor(t, "org_A");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cancelAtPeriodEnd: true, polarModifiedAt: T0 + 1000 });
  });

  it("rejects the same subscription ID arriving for a different organization", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    await apply(t);

    const hijack = baseEvent({ organizationId: "org_B", modifiedAt: T0 + 5000, status: "revoked" });
    const r = await t.mutation(internal.system.subscriptions.applyPolarEvent, hijack);

    expect(r).toEqual({ applied: false, reason: "wrong-organization" });
    // Nothing was created for org_B and org_A is untouched.
    expect(await rowsFor(t, "org_B")).toHaveLength(0);
    const [a] = await rowsFor(t, "org_A");
    expect(a).toMatchObject({ status: "active", plan: "pro", polarModifiedAt: T0 });
    // The rejected event is not marked as processed, so it can be re-evaluated.
    expect(await recordedEventIds(t)).not.toContain(hijack.eventId);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("protects a subscription from transfer even when its current holder is Free", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    await apply(t, { status: "revoked" });

    const r = await apply(t, { organizationId: "org_B", modifiedAt: T0 + 1000 });
    expect(r).toEqual({ applied: false, reason: "wrong-organization" });
    expect(await rowsFor(t, "org_B")).toHaveLength(0);
  });

  it("does not leak secrets or payloads into the error log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    await apply(t);
    await apply(t, { organizationId: "org_B" });

    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("sub_1");
    expect(logged).not.toMatch(/secret|signature|token/i);
  });
});

describe("applyPolarEvent: idempotency and ordering", () => {
  it("ignores a duplicate delivery of the same event ID", async () => {
    const t = convexTest(schema, modules);
    const event = baseEvent();
    const first = await t.mutation(internal.system.subscriptions.applyPolarEvent, event);
    const second = await t.mutation(internal.system.subscriptions.applyPolarEvent, event);

    expect(first).toMatchObject({ applied: true });
    expect(second).toEqual({ applied: false, reason: "duplicate" });
    expect((await recordedEventIds(t)).filter((id) => id === event.eventId)).toHaveLength(1);
    expect(await rowsFor(t, "org_A")).toHaveLength(1);
  });

  it("ignores an older event for the same subscription and records it", async () => {
    const t = convexTest(schema, modules);
    await apply(t, { modifiedAt: T0 + 2000 });
    const older = baseEvent({ modifiedAt: T0 + 1000, status: "revoked" });
    const r = await t.mutation(internal.system.subscriptions.applyPolarEvent, older);

    expect(r).toEqual({ applied: false, reason: "stale" });
    expect(await recordedEventIds(t)).toContain(older.eventId);
    const [row] = await rowsFor(t, "org_A");
    expect(row).toMatchObject({ status: "active", polarModifiedAt: T0 + 2000 });
  });
});

describe("applyPolarEvent: switching subscriptions", () => {
  it("never lets a superseded subscription return, even after the new one lapses", async () => {
    const t = convexTest(schema, modules);
    await apply(t, { polarSubscriptionId: "sub_1", modifiedAt: T0 });
    await apply(t, { polarSubscriptionId: "sub_1", status: "revoked", modifiedAt: T0 + 1000 });

    // B replaces A once A has lost access.
    const b = await apply(t, { polarSubscriptionId: "sub_2", modifiedAt: T0 + 2000 });
    expect(b).toMatchObject({ applied: true });
    expect(await supersededIds(t, "org_A")).toEqual(["sub_1"]);

    // B lapses; a delayed (newer-looking) event for A arrives.
    await apply(t, { polarSubscriptionId: "sub_2", status: "revoked", modifiedAt: T0 + 3000 });
    const late = await apply(t, { polarSubscriptionId: "sub_1", modifiedAt: T0 + 4000 });

    expect(late).toEqual({ applied: false, reason: "superseded" });
    const [row] = await rowsFor(t, "org_A");
    expect(row).toMatchObject({ polarSubscriptionId: "sub_2", status: "revoked" });
  });

  it("rejects a second live subscription while the first has paid access", async () => {
    const t = convexTest(schema, modules);
    await apply(t, { polarSubscriptionId: "sub_1" });

    const b = baseEvent({ polarSubscriptionId: "sub_2", modifiedAt: T0 + 1000 });
    const r = await t.mutation(internal.system.subscriptions.applyPolarEvent, b);

    expect(r).toEqual({ applied: false, reason: "other-subscription" });
    expect(await recordedEventIds(t)).not.toContain(b.eventId);
    const [row] = await rowsFor(t, "org_A");
    expect(row).toMatchObject({ polarSubscriptionId: "sub_1" });
  });

  it("applies the rejected subscription when the same event is redelivered after the first ends", async () => {
    const t = convexTest(schema, modules);
    await apply(t, { polarSubscriptionId: "sub_1", modifiedAt: T0 });

    const b = baseEvent({ polarSubscriptionId: "sub_2", modifiedAt: T0 + 1000 });
    const first = await t.mutation(internal.system.subscriptions.applyPolarEvent, b);
    expect(first).toMatchObject({ applied: false, reason: "other-subscription" });

    await apply(t, { polarSubscriptionId: "sub_1", status: "revoked", modifiedAt: T0 + 2000 });

    // Same event ID redelivered (e.g. from the Polar dashboard).
    const redelivered = await t.mutation(internal.system.subscriptions.applyPolarEvent, b);
    expect(redelivered).toMatchObject({ applied: true, plan: "pro" });

    const [row] = await rowsFor(t, "org_A");
    expect(row).toMatchObject({ polarSubscriptionId: "sub_2", status: "active" });
    expect(await supersededIds(t, "org_A")).toEqual(["sub_1"]);
  });
});

describe("applyPolarEvent: pastDueSince lifecycle", () => {
  it("starts the grace period on the first past_due event and keeps it on repeats", async () => {
    const t = convexTest(schema, modules);
    await apply(t, { status: "past_due", modifiedAt: T0 + 1 });
    const [first] = await rowsFor(t, "org_A");
    expect(first.pastDueSince).toBe(T0);

    vi.setSystemTime(T0 + 2 * DAY);
    await apply(t, { status: "past_due", modifiedAt: T0 + 2 });
    const [second] = await rowsFor(t, "org_A");
    expect(second.pastDueSince).toBe(T0);
  });

  it("clears pastDueSince on recovery and starts a fresh window on the next failure", async () => {
    const t = convexTest(schema, modules);
    await apply(t, { status: "past_due", modifiedAt: T0 + 1 });

    vi.setSystemTime(T0 + DAY);
    await apply(t, { status: "active", modifiedAt: T0 + 2 });
    const [recovered] = await rowsFor(t, "org_A");
    expect(recovered.pastDueSince).toBeUndefined();

    vi.setSystemTime(T0 + 3 * DAY);
    await apply(t, { status: "past_due", modifiedAt: T0 + 3 });
    const [again] = await rowsFor(t, "org_A");
    expect(again.pastDueSince).toBe(T0 + 3 * DAY);
  });
})