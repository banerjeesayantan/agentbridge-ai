/**
 * Pure policy for the Free-plan voice demo. No database or network access,
 * so every rule here is unit-tested (see voiceDemo.test.mts).
 *
 * Principles:
 *  - Fail closed: a missing/invalid budget means "no capacity", never "unlimited".
 *  - The demo only ever spends the developer's configured, finite budgets.
 *  - Budgets are CONFIGURED limits, not provider-reported balances. Nothing here
 *    claims to know a provider's real remaining credit.
 */

/** Providers that have an adapter implemented AND verified. Add one only after verifying it. */
export const IMPLEMENTED_PROVIDERS = ["vapi"] as const;
export type VoiceProviderId = (typeof IMPLEMENTED_PROVIDERS)[number];

export interface VoiceDemoConfig {
  enabled: boolean;
  /** Preferred order, filtered to implemented providers. */
  order: VoiceProviderId[];
  globalBudgetSeconds: number;
  providerBudgetSeconds: Record<VoiceProviderId, number>;
  maxSessionSeconds: number;
  minSuccessSeconds: number;
  minUserTurns: number;
  /** Lifetime cap on demo attempts per organization (bounds retries). */
  maxAttemptsPerOrg: number;
  /** Max provider switches inside one session before it starts. */
  maxFallbacksPerSession: number;
  /** An unstarted reservation is released after this long. */
  reservationTtlSeconds: number;
  /** "total" = one lifetime budget; "monthly" = resets each UTC month. */
  period: "total" | "monthly";
}

type Env = Record<string, string | undefined>;

function intFrom(raw: string | undefined, fallback: number, min = 0, max = 1_000_000_000): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export function readConfig(env: Env): VoiceDemoConfig {
  const requested = (env.VOICE_DEMO_PROVIDER_ORDER ?? "vapi")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const order: VoiceProviderId[] = [];
  for (const id of requested) {
    if ((IMPLEMENTED_PROVIDERS as readonly string[]).includes(id) && !order.includes(id as VoiceProviderId)) {
      order.push(id as VoiceProviderId);
    }
  }
  return {
    enabled: env.VOICE_DEMO_ENABLED === "true",
    order,
    // Unset or invalid budgets are 0, which denies. That is deliberate (fail closed).
    globalBudgetSeconds: intFrom(env.VOICE_DEMO_GLOBAL_BUDGET_SECONDS, 0),
    providerBudgetSeconds: { vapi: intFrom(env.VOICE_DEMO_VAPI_BUDGET_SECONDS, 0) },
    maxSessionSeconds: intFrom(env.VOICE_DEMO_MAX_SESSION_SECONDS, 180, 10, 3600),
    minSuccessSeconds: intFrom(env.VOICE_DEMO_MIN_SUCCESS_SECONDS, 20, 1, 3600),
    minUserTurns: intFrom(env.VOICE_DEMO_MIN_USER_TURNS, 1, 0, 100),
    maxAttemptsPerOrg: intFrom(env.VOICE_DEMO_MAX_ATTEMPTS_PER_ORG, 5, 1, 100),
    maxFallbacksPerSession: intFrom(env.VOICE_DEMO_MAX_FALLBACKS, 2, 0, 10),
    reservationTtlSeconds: intFrom(env.VOICE_DEMO_RESERVATION_TTL_SECONDS, 120, 30, 3600),
    period: env.VOICE_DEMO_BUDGET_PERIOD === "monthly" ? "monthly" : "total",
  };
}

export function periodKey(config: Pick<VoiceDemoConfig, "period">, now: number): string {
  if (config.period === "total") return "total";
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface QuotaRow {
  reservedSeconds: number;
  usedSeconds: number;
}

/** Remaining configured capacity. Never negative. */
export function remaining(budget: number, row: QuotaRow | null | undefined): number {
  const spent = (row?.reservedSeconds ?? 0) + (row?.usedSeconds ?? 0);
  return Math.max(0, budget - spent);
}

/**
 * Pick the first provider (in order) that is eligible and has room for one full
 * session under BOTH its own budget and the global budget. Returns null if none.
 */
export function pickProvider(input: {
  config: VoiceDemoConfig;
  quota: { global: QuotaRow | null; providers: Partial<Record<VoiceProviderId, QuotaRow | null>> };
  /** Providers with the public config they need present (checked by the caller). */
  available: ReadonlySet<VoiceProviderId>;
  exclude?: ReadonlySet<VoiceProviderId>;
}): VoiceProviderId | null {
  const { config, quota, available, exclude } = input;
  const need = config.maxSessionSeconds;
  if (remaining(config.globalBudgetSeconds, quota.global) < need) return null;
  for (const id of config.order) {
    if (!available.has(id) || exclude?.has(id)) continue;
    if (remaining(config.providerBudgetSeconds[id], quota.providers[id]) >= need) return id;
  }
  return null;
}

/**
 * Success criteria for consuming the one-time trial. All must hold, using
 * SERVER-measured time (never the client's claim alone):
 *  - the call actually started (provider connected),
 *  - it lasted at least `minSuccessSeconds`,
 *  - the visitor spoke at least `minUserTurns` times,
 *  - the client did not report a provider error.
 */
export function isSuccessfulSession(input: {
  started: boolean;
  serverElapsedSeconds: number;
  clientDurationSeconds: number;
  userTurns: number;
  providerError: boolean;
  config: Pick<VoiceDemoConfig, "minSuccessSeconds" | "minUserTurns">;
}): boolean {
  if (!input.started || input.providerError) return false;
  const duration = Math.min(input.serverElapsedSeconds, input.clientDurationSeconds);
  return duration >= input.config.minSuccessSeconds && input.userTurns >= input.config.minUserTurns;
}

/**
 * Seconds to charge to the budget for a started call: the server-measured
 * elapsed time, capped at what was reserved. A client cannot lower this.
 */
export function chargedSeconds(serverElapsedSeconds: number, reservedSeconds: number): number {
  return Math.max(0, Math.min(Math.ceil(serverElapsedSeconds), reservedSeconds));
}

export type DenyCode =
  | "DEMO_DISABLED"
  | "TRIAL_USED"
  | "IN_PROGRESS"
  | "ATTEMPTS_EXCEEDED"
  | "NO_CAPACITY"
  | "ORG_NOT_VERIFIED"
  | "SESSION_INVALID";

export const DENY_MESSAGES: Record<DenyCode, string> = {
  DEMO_DISABLED: "The voice demo is not available right now.",
  TRIAL_USED: "Your free voice trial has been used. Upgrade your plan to keep using voice.",
  IN_PROGRESS: "A voice demo is already in progress for this organization.",
  ATTEMPTS_EXCEEDED: "The voice demo has reached its attempt limit for this organization. Upgrade your plan to use voice.",
  NO_CAPACITY: "The voice demo is temporarily unavailable. Please try again later, or upgrade your plan.",
  ORG_NOT_VERIFIED: "This organization could not be verified.",
  SESSION_INVALID: "Your session is not valid. Please reload and try again.",
};
