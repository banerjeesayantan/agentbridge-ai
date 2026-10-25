/**
 * Single authoritative plan/entitlement mapping. The frontend never decides
 * what a plan allows; it renders what `private.usage.summary` returns.
 *
 * Quotas below are PROPOSED DEFAULTS (not Polar data). Prices are never
 * defined here: they come from the real Polar products at runtime.
 */
import type { QueryCtx } from "../_generated/server";

export const PLAN_KEYS = ["free", "pro", "enterprise"] as const;
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
}

export const PLANS: Record<PlanKey, { name: string; limits: PlanLimits }> = {
  free: {
    name: "Free",
    limits: { aiMessages: 100, knowledgeFiles: 5, voice: false, members: 1 },
  },
  pro: {
    name: "Pro",
    limits: { aiMessages: 2000, knowledgeFiles: 100, voice: true, members: 5 },
  },
  enterprise: {
    name: "Enterprise",
    limits: { aiMessages: 10000, knowledgeFiles: 500, voice: true, members: 15 },
  },
};


/** Keep paid access this long after a payment fails (status past_due). */
export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** If we stop hearing from Polar this long after a period ended, fall back to Free. */
export const STALE_PERIOD_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

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
  plan === "pro" || plan === "enterprise";

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
 * unverified status or stale data all resolve to Free, never to paid.
 */
export function resolveEntitlements(
  sub: SubscriptionLike | null | undefined,
  now: number,
): ResolvedEntitlements {
  const free = (status: string, extra: Partial<ResolvedEntitlements> = {}): ResolvedEntitlements => {
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

  if (!sub || !isPaidPlan(sub.plan)) return free(sub?.status ?? "none");

  const hasPeriod = sub.currentPeriodStart !== undefined && sub.currentPeriodEnd !== undefined;
  if (!hasPeriod) return free(sub.status);
  if (now > sub.currentPeriodEnd! + STALE_PERIOD_GRACE_MS) return free("stale");

  let entitled = false;
  let pastDue = false;
  let graceEndsAt: number | null = null;

  if (sub.status === "active" || sub.status === "trialing") {
    entitled = true;
  } else if (sub.status === "past_due") {
    pastDue = true;
    graceEndsAt = (sub.pastDueSince ?? now) + PAST_DUE_GRACE_MS;
    entitled = now < graceEndsAt;
  }

  if (!entitled) return free(sub.status, { pastDue, graceEndsAt });

  return {
    plan: sub.plan,
    planName: PLANS[sub.plan].name,
    status: sub.status,
    limits: PLANS[sub.plan].limits,
    periodStart: sub.currentPeriodStart!,
    periodEnd: sub.currentPeriodEnd!,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
    pastDue,
    graceEndsAt,
  };
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
}
