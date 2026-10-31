/**
 * Single authoritative plan/entitlement mapping. The frontend never decides
 * what a plan allows; it renders what `private.usage.summary` returns.
 *
 * Quotas below are PROPOSED DEFAULTS (not Polar data). Prices are never
 * defined here: they come from the real Polar products at runtime.
 */
import type { QueryCtx } from "../_generated/server";

export const PLAN_KEYS = ["free", "pro", "business"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export type PaidPlanKey = Exclude<PlanKey, "free">;

export interface PlanLimits {
  /** AI replies + AI message enhancements per usage period. */
  aiMessages: number;
  /** Knowledge-base files held at any one time. */
  knowledgeFiles: number;
  /** Voice assistant (Vapi) available. */
  voice: boolean;
  /** Clerk organization member cap. */
  members: number;
  /** Feedback comments + CSV report export (basic counts are on every plan). */
  advancedFeedback: boolean;
}

export const PLANS: Record<PlanKey, { name: string; limits: PlanLimits }> = {
  free: { name: "Free", limits: { aiMessages: 100, knowledgeFiles: 5, voice: false, members: 1, advancedFeedback: false } },
  pro: { name: "Pro", limits: { aiMessages: 2000, knowledgeFiles: 100, voice: true, members: 5, advancedFeedback: true } },
  business: { name: "Business", limits: { aiMessages: 10000, knowledgeFiles: 500, voice: true, members: 15, advancedFeedback: true } },
};

/** Keep paid access this long after a payment fails (status past_due). */
export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** If we stop hearing from Polar this long after a period ended, fall back to Free. */
export const STALE_PERIOD_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
/** Clock difference tolerated between Polar and this backend at a period's start. */
export const PERIOD_START_SKEW_MS = 5 * 60 * 1000;

export interface SubscriptionLike {
  plan?: string;
  status: string;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  pastDueSince?: number;
}

export interface ResolvedEntitlements {
  plan: PlanKey;
  planName: string;
  status: string;
  limits: PlanLimits;
  /** Start of the current usage period (ms). Used as the counter key. */
  periodStart: number;
  /** When the allowance resets (ms). */
  periodEnd: number;
  cancelAtPeriodEnd: boolean;
  pastDue: boolean;
  graceEndsAt: number | null;
}

const isPaidPlan = (plan: string | undefined): plan is PaidPlanKey =>
  plan === "pro" || plan === "business";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Calendar month in UTC: the Free plan's usage period. */
export function calendarMonth(now: number): { start: number; end: number } {
  const d = new Date(now);
  return {
    start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
    end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
  };
}

/**
 * Pure policy function. Absence of a subscription, an unknown plan, an
 * unverified status, an invalid billing period or stale data all resolve to
 * Free, never to paid.
 *
 * Access rules:
 *  - active / trialing        -> paid, until the period end + stale buffer
 *  - scheduled cancellation   -> paid until the period end, then Free
 *  - past_due                 -> paid for PAST_DUE_GRACE_MS after the failure
 *                                (measured from `pastDueSince`, not "now");
 *                                a missing/invalid `pastDueSince` -> Free
 *  - anything else            -> Free
 */
export function resolveEntitlements(
  sub: SubscriptionLike | null | undefined,
  now: number,
): ResolvedEntitlements {
  const free = (
    status: string,
    extra: Partial<ResolvedEntitlements> = {},
  ): ResolvedEntitlements => {
    const { start, end } = calendarMonth(now);

    return {
      plan: "free",
      planName: PLANS.free.name,
      status,
      limits: PLANS.free.limits,
      periodStart: start,
      periodEnd: end,
      cancelAtPeriodEnd: false,
      pastDue: false,
      graceEndsAt: null,
      ...extra,
    };
  };

  if (!sub || !isPaidPlan(sub.plan)) {
    return free(sub?.status ?? "none");
  }

  const plan: PaidPlanKey = sub.plan;
  const start = sub.currentPeriodStart;
  const end = sub.currentPeriodEnd;

  // Do not grant paid access using incomplete or invalid billing periods.
  if (!isFiniteNumber(start) || !isFiniteNumber(end) || start >= end) {
    return free(sub.status);
  }

  // A period that hasn't started yet grants nothing. The small tolerance
  // avoids briefly downgrading a customer whose webhook carries a start time
  // a few seconds ahead of this backend's clock.
  if (now + PERIOD_START_SKEW_MS < start) {
    return free(sub.status);
  }

  const paid = (pastDue: boolean, graceEndsAt: number | null): ResolvedEntitlements => ({
    plan,
    planName: PLANS[plan].name,
    status: sub.status,
    limits: PLANS[plan].limits,
    periodStart: start,
    periodEnd: end,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
    pastDue,
    graceEndsAt,
  });

  // An explicitly scheduled cancellation ends paid access at period end.
  if (sub.cancelAtPeriodEnd && now >= end) {
    return free("canceled");
  }

  // Payment failures have their own seven-day grace period.
  // The stale-data check below deliberately does not apply here, so it
  // cannot shorten this window.
  if (sub.status === "past_due") {
    const failedAt = sub.pastDueSince;

    // No verifiable payment-failure timestamp: fail closed rather than
    // guessing a deadline. Legacy rows must be repaired, not silently trusted.
    if (!isFiniteNumber(failedAt) || failedAt < 0 || failedAt > now) {
      return free(sub.status, { pastDue: true, graceEndsAt: null });
    }

    const graceEndsAt = failedAt + PAST_DUE_GRACE_MS;

    if (now >= graceEndsAt) {
      return free(sub.status, { pastDue: true, graceEndsAt });
    }

    return paid(true, graceEndsAt);
  }

  // Active and trialing subscriptions retain access.
  if (sub.status === "active" || sub.status === "trialing") {
    // If webhook updates stop arriving, eventually fall back to Free.
    if (now > end + STALE_PERIOD_GRACE_MS) {
      return free("stale");
    }

    return paid(false, null);
  }

  // Canceled, revoked, unpaid, unknown and other unrecognized statuses
  // do not grant paid access.
  return free(sub.status);
}

/** Load the organization's subscription and resolve what it may do right now. */
export async function getEntitlements(
  ctx: Pick<QueryCtx, "db">,
  organizationId: string,
  now: number = Date.now(),
): Promise<ResolvedEntitlements> {
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_organization_id", (q) => q.eq("organizationId", organizationId))
    .unique();
  return resolveEntitlements(sub, now);
}

export function limitError(metric: string, used: number, limit: number, resetsAt: number) {
  return {
    code: "LIMIT_REACHED" as const,
    message: `Your plan's ${metric} limit (${limit}) has been reached. It resets on ${new Date(resetsAt).toISOString().slice(0, 10)}, or upgrade your plan to continue.`,
    metric,
    used,
    limit,
    resetsAt,
  };
};