import { describe, expect, it } from "vitest";
import {
  decideSubscriptionEvent,
  type ExistingSubscription,
  type IncomingSubscriptionEvent,
} from "../lib/Subscriptionevents";
import { PAST_DUE_GRACE_MS } from "./entitlements";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

const existing = (o: Partial<ExistingSubscription> = {}): ExistingSubscription => ({
  plan: "pro",
  status: "active",
  currentPeriodStart: NOW - 10 * DAY,
  currentPeriodEnd: NOW + 20 * DAY,
  polarSubscriptionId: "sub_A",
  polarModifiedAt: NOW - DAY,
  ...o,
});

const incoming = (o: Partial<IncomingSubscriptionEvent> = {}): IncomingSubscriptionEvent => ({
  polarSubscriptionId: "sub_A",
  status: "active",
  modifiedAt: NOW,
  ...o,
});

const decide = (
  ex: ExistingSubscription | null,
  inc: IncomingSubscriptionEvent,
  incomingIsSuperseded = false,
) => decideSubscriptionEvent({ existing: ex, incoming: inc, incomingIsSuperseded, now: NOW });

describe("same-subscription ordering", () => {
  it("applies the first event for an organization", () => {
    expect(decide(null, incoming())).toEqual({
      action: "apply",
      pastDueSince: undefined,
      supersedes: null,
    });
  });

  it("applies a newer event", () => {
    expect(decide(existing(), incoming({ modifiedAt: NOW })).action).toBe("apply");
  });

  it("applies an event with an identical modifiedAt (idempotent re-send)", () => {
    const d = decide(existing({ polarModifiedAt: NOW }), incoming({ modifiedAt: NOW }));
    expect(d.action).toBe("apply");
  });

  it("ignores an older event arriving after a newer one", () => {
    const d = decide(existing({ polarModifiedAt: NOW }), incoming({ modifiedAt: NOW - 1 }));
    expect(d).toEqual({ action: "ignore", reason: "stale", recordEvent: true });
  });
});

describe("switching subscriptions", () => {
  it("rejects subscription B while A still has paid access (live event)", () => {
    const d = decide(existing(), incoming({ polarSubscriptionId: "sub_B" }));
    expect(d).toEqual({ action: "ignore", reason: "other-subscription", recordEvent: false });
  });

  it("rejects an end/cancel event for another subscription while A is paid", () => {
    const d = decide(existing(), incoming({ polarSubscriptionId: "sub_B", status: "revoked" }));
    expect(d).toMatchObject({ action: "ignore", reason: "other-subscription" });
  });

  it("does not record rejected cross-subscription events, so a redelivery is re-evaluated", () => {
    const d = decide(existing(), incoming({ polarSubscriptionId: "sub_B" }));
    expect(d).toMatchObject({ recordEvent: false });
  });

  it("lets B replace A once A has lost access, and marks A as superseded", () => {
    const d = decide(existing({ status: "revoked" }), incoming({ polarSubscriptionId: "sub_B" }));
    expect(d).toEqual({ action: "apply", pastDueSince: undefined, supersedes: "sub_A" });
  });

  it("lets B replace A after A's scheduled cancellation has taken effect", () => {
    const d = decide(
      existing({ cancelAtPeriodEnd: true, currentPeriodEnd: NOW - DAY }),
      incoming({ polarSubscriptionId: "sub_B" }),
    );
    expect(d).toMatchObject({ action: "apply", supersedes: "sub_A" });
  });

  it("never lets a superseded subscription return, even when the current one is Free", () => {
    // B is current but has lost access; a delayed event for old A arrives.
    const b = existing({ polarSubscriptionId: "sub_B", status: "revoked" });
    const d = decide(b, incoming({ polarSubscriptionId: "sub_A" }), true);
    expect(d).toEqual({ action: "ignore", reason: "superseded", recordEvent: true });
  });

  it("applies a first-ever event for a legacy row with no subscription ID", () => {
    const legacy: ExistingSubscription = { status: "active" };
    expect(decide(legacy, incoming()).action).toBe("apply");
  });
});

describe("pastDueSince", () => {
  it("starts the grace period on the first past_due event", () => {
    const d = decide(existing(), incoming({ status: "past_due" }));
    expect(d).toMatchObject({ action: "apply", pastDueSince: NOW });
  });

  it("keeps the original timestamp on repeated past_due events of the same subscription", () => {
    const since = NOW - 2 * DAY;
    const d = decide(existing({ status: "past_due", pastDueSince: since }), incoming({ status: "past_due" }));
    expect(d).toMatchObject({ pastDueSince: since });
  });

  it("starts a fresh grace period for a different subscription", () => {
    const old = existing({ status: "past_due", pastDueSince: NOW - PAST_DUE_GRACE_MS - DAY });
    const d = decide(old, incoming({ polarSubscriptionId: "sub_B", status: "past_due" }));
    expect(d).toMatchObject({ action: "apply", pastDueSince: NOW, supersedes: "sub_A" });
  });

  it("starts a new grace period when the stored timestamp is missing or invalid", () => {
    for (const bad of [undefined, Number.NaN]) {
      const d = decide(existing({ status: "past_due", pastDueSince: bad }), incoming({ status: "past_due" }));
      expect(d).toMatchObject({ pastDueSince: NOW });
    }
  });

  it("clears pastDueSince on recovery to active", () => {
    const d = decide(existing({ status: "past_due", pastDueSince: NOW - DAY }), incoming({ status: "active" }));
    expect(d).toMatchObject({ action: "apply", pastDueSince: undefined });
  });

  it("starts a new grace period when past_due happens again after a recovery", () => {
    const recovered = existing({ status: "active", pastDueSince: undefined });
    const d = decide(recovered, incoming({ status: "past_due" }));
    expect(d).toMatchObject({ pastDueSince: NOW });
  });
});