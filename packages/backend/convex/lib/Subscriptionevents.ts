/**
 * Pure decision logic for one verified Polar subscription event.
 * No database access: the mutation loads the inputs, calls this, and executes
 * the returned decision. That keeps every lifecycle rule unit-testable.
 */
import { resolveEntitlements, type SubscriptionLike } from "./entitlements";

export interface ExistingSubscription extends SubscriptionLike {
  polarSubscriptionId?: string;
  polarModifiedAt?: number;
}

export interface IncomingSubscriptionEvent {
  polarSubscriptionId: string;
  status: string;
  modifiedAt: number;
}

export type SubscriptionEventDecision =
  | {
      action: "apply";
      /** New pastDueSince to store (undefined clears it). */
      pastDueSince: number | undefined;
      /** Subscription ID this event replaces, to be recorded as superseded. */
      supersedes: string | null;
    }
  | {
      action: "ignore";
      reason: "stale" | "superseded" | "other-subscription";
      /**
       * Whether to mark the webhook event as processed. False for
       * "other-subscription", so a redelivery of that event is re-evaluated
       * instead of being dropped as a duplicate.
       */
      recordEvent: boolean;
    };

export function decideSubscriptionEvent(input: {
  existing: ExistingSubscription | null;
  incoming: IncomingSubscriptionEvent;
  /** True if the incoming subscription ID was previously replaced for this org. */
  incomingIsSuperseded: boolean;
  now: number;
}): SubscriptionEventDecision {
  const { existing, incoming, incomingIsSuperseded, now } = input;

  // A replaced subscription can never become current again, even if the
  // subscription that replaced it has since lost access.
  if (incomingIsSuperseded) {
    return { action: "ignore", reason: "superseded", recordEvent: true };
  }

  const isSameSubscription =
    existing !== null &&
    existing.polarSubscriptionId === incoming.polarSubscriptionId;

  if (existing !== null && isSameSubscription) {
    if ((existing.polarModifiedAt ?? 0) > incoming.modifiedAt) {
      return { action: "ignore", reason: "stale", recordEvent: true };
    }
  } else if (existing !== null && existing.polarSubscriptionId) {
    // Never let another subscription replace an organization that still has
    // valid paid access.
    if (resolveEntitlements(existing, now).plan !== "free") {
      return { action: "ignore", reason: "other-subscription", recordEvent: false };
    }
  }

  // Keep the original failure time only for repeated past_due events of the
  // SAME subscription; every other case starts a fresh grace period.
  let pastDueSince: number | undefined;
  if (incoming.status === "past_due") {
    const keep =
      existing !== null &&
      isSameSubscription &&
      existing.status === "past_due" &&
      typeof existing.pastDueSince === "number" &&
      Number.isFinite(existing.pastDueSince);
    pastDueSince = keep ? existing.pastDueSince : now;
  }

  const supersedes =
    existing !== null && existing.polarSubscriptionId && !isSameSubscription
      ? existing.polarSubscriptionId
      : null;

  return { action: "apply", pastDueSince, supersedes };
}