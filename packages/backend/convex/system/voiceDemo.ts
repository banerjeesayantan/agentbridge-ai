import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { getEntitlements } from "../lib/entitlements";
import {
  chargedSeconds,
  DENY_MESSAGES,
  isSuccessfulSession,
  periodKey,
  pickProvider,
  readConfig,
  type DenyCode,
  type VoiceProviderId,
} from "../lib/voiceDemo";

/**
 * Free-plan voice demo: quota reservations and the one-time trial.
 *
 * Every function here is a Convex mutation, i.e. a serialized transaction, so
 * two simultaneous starts cannot both read the same remaining capacity and
 * both reserve it. All of them are internal; the browser reaches them only
 * through public/voiceDemo.ts, which validates the contact session first.
 */

const SECOND = 1000;
const config = () => readConfig(process.env);

/** Public (browser-safe) settings per provider. Missing => provider unavailable. */
function providerPublicConfig(id: VoiceProviderId): Record<string, string> | null {
  if (id === "vapi") {
    const publicKey = process.env.VAPI_DEMO_PUBLIC_KEY?.trim();
    const assistantId = process.env.VAPI_DEMO_ASSISTANT_ID?.trim();
    return publicKey && assistantId ? { publicKey, assistantId } : null;
  }
  return null;
}

function availableProviders(): Set<VoiceProviderId> {
  const out = new Set<VoiceProviderId>();
  for (const id of config().order) if (providerPublicConfig(id)) out.add(id);
  return out;
}

function deny(code: DenyCode): never {
  throw new ConvexError({ code, message: DENY_MESSAGES[code] });
}

async function getQuotaRow(ctx: MutationCtx, provider: string, key: string) {
  return await ctx.db
    .query("voiceQuota")
    .withIndex("by_provider_period", (q) => q.eq("provider", provider).eq("periodKey", key))
    .unique();
}

async function adjustQuota(
  ctx: MutationCtx,
  provider: string,
  key: string,
  delta: { reserved?: number; used?: number },
) {
  const row = await getQuotaRow(ctx, provider, key);
  const reserved = Math.max(0, (row?.reservedSeconds ?? 0) + (delta.reserved ?? 0));
  const used = Math.max(0, (row?.usedSeconds ?? 0) + (delta.used ?? 0));
  if (row) await ctx.db.patch(row._id, { reservedSeconds: reserved, usedSeconds: used });
  else await ctx.db.insert("voiceQuota", { provider, periodKey: key, reservedSeconds: reserved, usedSeconds: used });
}

/** Reserve one full session under the provider AND global budgets, or return null. */
async function reserveFor(
  ctx: MutationCtx,
  key: string,
  exclude: Set<VoiceProviderId>,
): Promise<VoiceProviderId | null> {
  const cfg = config();
  const providers: Partial<Record<VoiceProviderId, { reservedSeconds: number; usedSeconds: number } | null>> = {};
  for (const id of cfg.order) providers[id] = await getQuotaRow(ctx, id, key);
  const provider = pickProvider({
    config: cfg,
    quota: { global: await getQuotaRow(ctx, "global", key), providers },
    available: availableProviders(),
    exclude,
  });
  if (!provider) return null;
  await adjustQuota(ctx, provider, key, { reserved: cfg.maxSessionSeconds });
  await adjustQuota(ctx, "global", key, { reserved: cfg.maxSessionSeconds });
  return provider;
}

async function releaseReservation(ctx: MutationCtx, session: Doc<"voiceSessions">, used = 0) {
  await adjustQuota(ctx, session.provider, session.periodKey, { reserved: -session.reservedSeconds, used });
  await adjustQuota(ctx, "global", session.periodKey, { reserved: -session.reservedSeconds, used });
}

/** Settle sessions that were abandoned. Safe to call repeatedly. */
async function settleStale(ctx: MutationCtx, now: number, organizationId?: string, limit = 50) {
  const cfg = config();
  const open = [
    ...(await ctx.db.query("voiceSessions").withIndex("by_status_and_created_at", (q) => q.eq("status", "reserved")).take(limit)),
    ...(await ctx.db.query("voiceSessions").withIndex("by_status_and_created_at", (q) => q.eq("status", "active")).take(limit)),
  ];
  let settled = 0;
  for (const s of open) {
    if (organizationId && s.organizationId !== organizationId) continue;
    if (s.status === "reserved" && now - s.createdAt > cfg.reservationTtlSeconds * SECOND) {
      // Never connected: hand the capacity back.
      await releaseReservation(ctx, s);
      await ctx.db.patch(s._id, { status: "released", endedAt: now, chargedSeconds: 0, events: [...s.events, { at: now, provider: s.provider, kind: "reservation-timeout" }] });
      settled++;
    } else if (s.status === "active" && s.startedAt && now - s.startedAt > (s.reservedSeconds + 60) * SECOND) {
      // Started but never reported. Fail closed: charge the whole reservation.
      // The trial is NOT consumed (success was never established), but the
      // attempt still counts toward the per-organization attempt cap.
      await releaseReservation(ctx, s, s.reservedSeconds);
      await ctx.db.patch(s._id, { status: "expired", endedAt: now, chargedSeconds: s.reservedSeconds, events: [...s.events, { at: now, provider: s.provider, kind: "expired-unreported" }] });
      settled++;
    }
  }
  return settled;
}

/** Hold capacity for one demo session. Idempotent for an existing unstarted reservation. */
export const reserve = internalMutation({
  args: { organizationId: v.string(), contactSessionId: v.id("contactSessions") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const cfg = config();
    if (!cfg.enabled) deny("DEMO_DISABLED");

    await settleStale(ctx, now, args.organizationId);

    const trial = await ctx.db.query("voiceTrials").withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId)).first();
    if (trial) deny("TRIAL_USED");

    const sessions = await ctx.db.query("voiceSessions").withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId)).collect();

    const open = sessions.find((s) => s.status === "reserved" || s.status === "active");
    if (open?.status === "active") deny("IN_PROGRESS");
    if (open) {
      if (open.contactSessionId === args.contactSessionId) {
        // A refresh or retry by the SAME visitor gets the SAME reservation.
        return { sessionId: open._id, provider: open.provider as VoiceProviderId, maxSeconds: open.reservedSeconds, publicConfig: providerPublicConfig(open.provider as VoiceProviderId)! };
      }

      // Never hand one visitor's reservation to another. While the owner's
      // contact session is still valid, the reservation stays theirs.
      const owner = await ctx.db.get(open.contactSessionId);
      if (owner && owner.expiresAt >= now) deny("IN_PROGRESS");

      // The owner is gone (expired or deleted): release the orphaned
      // reservation and fall through, so this visitor gets their OWN.
      await releaseReservation(ctx, open);
      await ctx.db.patch(open._id, {
        status: "released",
        endedAt: now,
        chargedSeconds: 0,
        events: [...open.events, { at: now, provider: open.provider, kind: "owner-expired" }],
      });
    }

    if (sessions.length >= cfg.maxAttemptsPerOrg) deny("ATTEMPTS_EXCEEDED");

    const key = periodKey(cfg, now);
    const provider = await reserveFor(ctx, key, new Set());
    if (!provider) deny("NO_CAPACITY");

    const sessionId = await ctx.db.insert("voiceSessions", {
      organizationId: args.organizationId,
      contactSessionId: args.contactSessionId,
      provider: provider!,
      periodKey: key,
      status: "reserved",
      reservedSeconds: cfg.maxSessionSeconds,
      createdAt: now,
      fallbackCount: 0,
      triedProviders: [provider!],
      events: [{ at: now, provider: provider!, kind: "reserved" }],
    });
    return { sessionId, provider: provider!, maxSeconds: cfg.maxSessionSeconds, publicConfig: providerPublicConfig(provider!)! };
  },
});

async function loadOwned(ctx: MutationCtx, sessionId: Id<"voiceSessions">, contactSessionId: Id<"contactSessions">) {
  const session = await ctx.db.get(sessionId);
  const contact = await ctx.db.get(contactSessionId);
  if (
    !session ||
    !contact ||
    // Only the exact contact session that owns the reservation may control it.
    session.contactSessionId !== contactSessionId ||
    contact.organizationId !== session.organizationId ||
    contact.expiresAt < Date.now()
  ) deny("SESSION_INVALID");
  return session!;
}

/**
 * The selected provider failed BEFORE the call began: release it and move to
 * the next eligible provider. Never used for an active call (no mid-call switching).
 */
export const switchProvider = internalMutation({
  args: { sessionId: v.id("voiceSessions"), contactSessionId: v.id("contactSessions"), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const cfg = config();
    const s = await loadOwned(ctx, args.sessionId, args.contactSessionId);
    if (s.status !== "reserved") deny("SESSION_INVALID");

    await releaseReservation(ctx, s);
    const events = [...s.events, { at: now, provider: s.provider, kind: "provider-failed", error: (args.error ?? "unknown").slice(0, 200) }];
    const tried = new Set(s.triedProviders as VoiceProviderId[]);

    const next = s.fallbackCount < cfg.maxFallbacksPerSession ? await reserveFor(ctx, s.periodKey, tried) : null;
    if (!next) {
      await ctx.db.patch(s._id, { status: "released", endedAt: now, chargedSeconds: 0, events });
      deny("NO_CAPACITY");
    }
    await ctx.db.patch(s._id, {
      provider: next!,
      fallbackCount: s.fallbackCount + 1,
      triedProviders: [...s.triedProviders, next!],
      createdAt: now,
      events: [...events, { at: now, provider: next!, kind: "fallback" }],
    });
    return { sessionId: s._id, provider: next!, maxSeconds: s.reservedSeconds, publicConfig: providerPublicConfig(next!)! };
  },
});

/** The provider reported the call connected. Starts the server-side clock. */
export const markStarted = internalMutation({
  args: { sessionId: v.id("voiceSessions"), contactSessionId: v.id("contactSessions"), providerCallId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const s = await loadOwned(ctx, args.sessionId, args.contactSessionId);
    if (s.status === "active") return { startedAt: s.startedAt! }; // idempotent
    if (s.status !== "reserved") deny("SESSION_INVALID");

    const providerCallId = args.providerCallId?.slice(0, 100);
    if (providerCallId) {
      // One provider call can be credited to one session only.
      const bound = await ctx.db
        .query("voiceSessions")
        .withIndex("by_provider_call_id", (q) => q.eq("providerCallId", providerCallId))
        .first();
      if (bound && bound._id !== s._id) deny("SESSION_INVALID");
    }

    await ctx.db.patch(s._id, {
      status: "active",
      startedAt: now,
      providerCallId,
      events: [...s.events, { at: now, provider: s.provider, kind: "started" }],
    });
    return { startedAt: now };
  },
});

/**
 * Close a session from the browser. Idempotent: repeating it (retry, double
 * click, refresh) can neither charge twice nor consume a trial.
 *
 * The browser's duration, turn count and error text are UNTRUSTED. They never
 * decide the trial: that is done only by applyCallReport, from the provider's
 * own end-of-call report. Here we close the session using server-measured time
 * and leave the trial to the report (which may upgrade it to "completed").
 */
export const finish = internalMutation({
  args: {
    sessionId: v.id("voiceSessions"),
    contactSessionId: v.id("contactSessions"),
    // Accepted for API compatibility; telemetry only, never used for decisions.
    clientDurationSeconds: v.number(),
    userTurns: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const s = await loadOwned(ctx, args.sessionId, args.contactSessionId);

    if (s.status === "completed") return { outcome: "completed" as const, trialConsumed: true };
    if (s.status !== "reserved" && s.status !== "active") {
      // The completed case has already returned above.
      return { outcome: s.status, trialConsumed: false };
    }
    // Never connected: release everything, nothing is consumed.
    if (s.status === "reserved" || !s.startedAt) {
      await releaseReservation(ctx, s);
      await ctx.db.patch(s._id, { status: "released", endedAt: now, chargedSeconds: 0, events: [...s.events, { at: now, provider: s.provider, kind: "ended-unstarted", error: args.error?.slice(0, 200) }] });
      return { outcome: "released" as const, trialConsumed: false };
    }

    const elapsed = (now - s.startedAt) / SECOND;
    const charge = chargedSeconds(elapsed, s.reservedSeconds);
    await releaseReservation(ctx, s, charge);
    await ctx.db.patch(s._id, {
      status: "ended_short",
      endedAt: now,
      chargedSeconds: charge,
      events: [...s.events, { at: now, provider: s.provider, kind: "client-closed", error: args.error?.slice(0, 200) }],
    });
    return { outcome: "ended_short" as const, trialConsumed: false };
  },
});

/**
 * Apply the provider's authoritative end-of-call report. This is the ONLY
 * place the trial can be consumed. Called by the verified provider webhook,
 * never by the browser. Idempotent.
 */
export const applyCallReport = internalMutation({
  args: {
    providerCallId: v.string(),
    durationSeconds: v.number(),
    userTurns: v.number(),
    providerError: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const cfg = config();
    const callId = args.providerCallId.slice(0, 100);

    const matches = await ctx.db
      .query("voiceSessions")
      .withIndex("by_provider_call_id", (q) => q.eq("providerCallId", callId))
      .take(2);
    if (matches.length === 0) return { applied: false as const, reason: "unknown-call" as const };
    if (matches.length > 1) return { applied: false as const, reason: "ambiguous-call" as const };

    const s = matches[0]!;
    if (s.status === "completed") return { applied: false as const, reason: "already-completed" as const };
    if (s.status !== "active" && s.status !== "ended_short" && s.status !== "expired") {
      return { applied: false as const, reason: "not-open" as const };
    }

    const duration = Number.isFinite(args.durationSeconds) ? Math.max(0, args.durationSeconds) : 0;
    const turns = Number.isFinite(args.userTurns) ? Math.max(0, Math.floor(args.userTurns)) : 0;
    const success = isSuccessfulSession({
      started: true,
      serverElapsedSeconds: duration,
      clientDurationSeconds: duration,
      userTurns: turns,
      providerError: args.providerError,
      config: cfg,
    });
    const charge = chargedSeconds(duration, s.reservedSeconds);

    let chargedTotal = s.chargedSeconds ?? 0;
    if (s.status === "active") {
      // The report beat the browser: settle the reservation now.
      await releaseReservation(ctx, s, charge);
      chargedTotal = charge;
    } else if (s.status === "ended_short") {
      // Already settled on server time; charge only what the report adds.
      const extra = Math.max(0, charge - chargedTotal);
      if (extra > 0) {
        await adjustQuota(ctx, s.provider, s.periodKey, { used: extra });
        await adjustQuota(ctx, "global", s.periodKey, { used: extra });
        chargedTotal += extra;
      }
    }
    // "expired" was already charged the full reservation, which is >= any real call.

    if (success) {
      const existing = await ctx.db.query("voiceTrials").withIndex("by_organization_id", (q) => q.eq("organizationId", s.organizationId)).first();
      if (!existing) await ctx.db.insert("voiceTrials", { organizationId: s.organizationId, sessionId: s._id, consumedAt: now });
    }

    const status = success ? ("completed" as const) : s.status === "expired" ? ("expired" as const) : ("ended_short" as const);
    await ctx.db.patch(s._id, {
      status,
      endedAt: s.endedAt ?? now,
      chargedSeconds: chargedTotal,
      events: [...s.events, { at: now, provider: s.provider, kind: success ? "report-completed" : "report-short" }],
    });
    return { applied: true as const, outcome: status === "completed" ? ("completed" as const) : ("ended_short" as const), trialConsumed: success };
  },
});

/** Cron: settle abandoned sessions. */
export const expireStale = internalMutation({
  args: {},
  handler: async (ctx) => ({ settled: await settleStale(ctx, Date.now()) }),
});

/** What the widget may show for an organization: no secrets, no budgets. */
export const eligibility = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const cfg = config();
    const trial = await ctx.db.query("voiceTrials").withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId)).first();
    if (trial) return { state: "trial_used" as const };
    if (!cfg.enabled) return { state: "unavailable" as const };
    const sessions = await ctx.db.query("voiceSessions").withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId)).collect();
    if (sessions.length >= cfg.maxAttemptsPerOrg) return { state: "attempts_exceeded" as const };
    return { state: "available" as const };
  },
});

/** Validate a contact session and resolve what this organization's plan allows. */
export const access = internalQuery({
  args: { contactSessionId: v.id("contactSessions") },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactSessionId);
    if (!contact || contact.expiresAt < Date.now()) return null;
    const ent = await getEntitlements(ctx, contact.organizationId);
    return { organizationId: contact.organizationId, paidVoice: ent.plan !== "free" && ent.limits.voice };
  },
});