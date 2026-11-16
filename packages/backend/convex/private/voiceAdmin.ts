import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "../_generated/server";
import { computeOrgAccounting } from "../lib/accounting";
import { DEFAULT_ALLOCATION, usdToMicro, validateAllocation } from "../lib/money";
import { isPlatformAdmin, requirePlatformAdmin } from "../lib/platformAdmin";
import { applyActualCost } from "../system/voiceWallet";

/**
 * Platform-admin financial operations. EVERY function starts with
 * requirePlatformAdmin(ctx): the authenticated Clerk user ID must be listed in
 * PLATFORM_ADMIN_USER_IDS, checked on the server. Each write adds an audit row.
 */

const ORG_ID = /^org_[A-Za-z0-9]{1,128}$/;
const ASSISTANT_ID = /^[A-Za-z0-9_-]{1,100}$/;
const CALL_ID = /^[A-Za-z0-9_-]{1,100}$/;

const bad = (code: string, message: string): never => {
  throw new ConvexError({ code, message });
};

async function audit(
  ctx: MutationCtx,
  actor: string,
  action: string,
  targetType: string,
  targetId: string,
  detail?: Record<string, string>,
) {
  await ctx.db.insert("adminAuditLog", { actorUserId: actor, action, targetType, targetId, detail, createdAt: Date.now() });
}

export const registerManagedAssistant = mutation({
  args: { organizationId: v.string(), vapiAssistantId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    if (!ORG_ID.test(args.organizationId)) return bad("INVALID", "Invalid organization ID");
    if (!ASSISTANT_ID.test(args.vapiAssistantId)) return bad("INVALID", "Invalid assistant ID");
    // The webhook routes the Free-demo assistant to the demo flow first; mapping it to an
    // organization would silently settle that organization's paid calls as free-demo calls.
    const demoAssistantId = process.env.VAPI_DEMO_ASSISTANT_ID?.trim();
    if (demoAssistantId && args.vapiAssistantId === demoAssistantId) {
      return bad("CONFLICT", "That assistant is reserved for the Free demo");
    }

    const byAssistant = await ctx.db
      .query("managedAssistants")
      .withIndex("by_vapi_assistant_id", (q) => q.eq("vapiAssistantId", args.vapiAssistantId))
      .first();
    if (byAssistant && byAssistant.organizationId !== args.organizationId) {
      return bad("CONFLICT", "That assistant is already mapped to another organization");
    }
    const byOrg = await ctx.db
      .query("managedAssistants")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .first();
    if (byOrg && byOrg.vapiAssistantId !== args.vapiAssistantId) {
      return bad("CONFLICT", "That organization already has a different managed assistant");
    }
    if (!byOrg) {
      await ctx.db.insert("managedAssistants", {
        organizationId: args.organizationId,
        vapiAssistantId: args.vapiAssistantId,
        createdAt: Date.now(),
        createdBy: actor,
      });
    }
    await audit(ctx, actor, "registerManagedAssistant", "organization", args.organizationId, {
      assistantId: args.vapiAssistantId,
    });
    return { ok: true as const };
  },
});

async function setSuspended(ctx: MutationCtx, organizationId: string, suspended: boolean, reason?: string) {
  const actor = await requirePlatformAdmin(ctx);
  if (!ORG_ID.test(organizationId)) return bad("INVALID", "Invalid organization ID");
  const existing = await ctx.db
    .query("orgVoiceControls")
    .withIndex("by_organization_id", (q) => q.eq("organizationId", organizationId))
    .first();
  const row = { suspended, reason: reason?.slice(0, 300), updatedAt: Date.now(), updatedBy: actor };
  if (existing) await ctx.db.patch(existing._id, row);
  else await ctx.db.insert("orgVoiceControls", { organizationId, ...row });
  await audit(ctx, actor, suspended ? "suspendOrganizationVoice" : "restoreOrganizationVoice", "organization", organizationId, {
    reason: reason?.slice(0, 300) ?? "",
  });
  return { ok: true as const };
}

export const suspendOrganizationVoice = mutation({
  args: { organizationId: v.string(), reason: v.optional(v.string()) },
  handler: (ctx, args) => setSuspended(ctx, args.organizationId, true, args.reason),
});

export const restoreOrganizationVoice = mutation({
  args: { organizationId: v.string(), reason: v.optional(v.string()) },
  handler: (ctx, args) => setSuspended(ctx, args.organizationId, false, args.reason),
});

/** Manual provider-account state. A balance set here is labelled "manual", never "verified". */
export const setProviderAccount = mutation({
  args: {
    balanceMicro: v.optional(v.number()),
    lowBalanceThresholdMicro: v.optional(v.number()),
    paused: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    for (const n of [args.balanceMicro, args.lowBalanceThresholdMicro]) {
      if (n !== undefined && !(Number.isSafeInteger(n) && n >= 0)) return bad("INVALID", "Amounts must be non-negative integer micro-dollars");
    }
    const existing = await ctx.db.query("providerAccount").withIndex("by_key", (q) => q.eq("key", "central")).first();
    const patch = {
      ...(args.balanceMicro !== undefined ? { balanceMicro: args.balanceMicro, balanceSource: "manual" as const } : {}),
      ...(args.lowBalanceThresholdMicro !== undefined ? { lowBalanceThresholdMicro: args.lowBalanceThresholdMicro } : {}),
      ...(args.paused !== undefined ? { paused: args.paused } : {}),
      updatedAt: Date.now(),
      updatedBy: actor,
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("providerAccount", { key: "central", paused: false, ...patch });
    await audit(ctx, actor, "setProviderAccount", "providerAccount", "central", {
      balance: args.balanceMicro === undefined ? "" : String(args.balanceMicro),
      paused: args.paused === undefined ? "" : String(args.paused),
    });
    return { ok: true as const };
  },
});

export const setRevenueAllocation = mutation({
  args: { parts: v.array(v.object({ key: v.string(), bps: v.number() })) },
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    if (!validateAllocation(args.parts) || !args.parts.some((p) => p.key === "operating")) {
      return bad("INVALID", "Allocation must be integer basis points totalling 10000 and include an 'operating' part");
    }
    const existing = await ctx.db.query("revenueAllocationSettings").withIndex("by_key", (q) => q.eq("key", "default")).first();
    const row = { parts: args.parts, updatedAt: Date.now(), updatedBy: actor };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("revenueAllocationSettings", { key: "default", ...row });
    await audit(ctx, actor, "setRevenueAllocation", "revenueAllocationSettings", "default", {
      parts: args.parts.map((p) => `${p.key}:${p.bps}`).join(","),
    });
    return { ok: true as const };
  },
});

/** Reconciliation: supply the real cost (USD, from Vapi) for a call recorded as pending. */
export const reconcileCallCost = mutation({
  args: { providerCallId: v.string(), costUsd: v.number() },
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    if (!CALL_ID.test(args.providerCallId)) return bad("INVALID", "Invalid call ID");
    const micro = usdToMicro(args.costUsd);
    if (micro === null) return bad("INVALID", "Cost must be a non-negative number");
    const result = await applyActualCost(ctx, {
      providerCallId: args.providerCallId,
      costMicro: micro,
      rawCostUsd: args.costUsd,
    });
    await audit(ctx, actor, "reconcileCallCost", "call", args.providerCallId, { costMicro: String(micro) });
    return result;
  },
});

/**
 * UI convenience only: lets the screen show "no access" instead of an error.
 * It decides nothing: every admin function above and below still enforces access itself.
 */
export const amIAdmin = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return { isAdmin: identity !== null && isPlatformAdmin(identity.subject, process.env) };
  },
});

const ORG_LIMIT = 100;

/** Financial overview. Bounded reads: `truncated` says when a cap was hit. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);

    const account = await ctx.db.query("providerAccount").withIndex("by_key", (q) => q.eq("key", "central")).first();
    const allocationRow = await ctx.db.query("revenueAllocationSettings").withIndex("by_key", (q) => q.eq("key", "default")).first();
    const allocation = allocationRow?.parts ?? [...DEFAULT_ALLOCATION];

    const wallets = await ctx.db.query("voiceWallets").order("desc").take(ORG_LIMIT + 1);
    const truncated = wallets.length > ORG_LIMIT;
    const shown = wallets.slice(0, ORG_LIMIT);

    const organizations = [];
    let walletRemaining = 0;
    let reserved = 0;
    const totals = { netCollectedMicro: 0, vapiExpenseKnownMicro: 0, contributionMicro: 0, pendingCostCalls: 0 };

    for (const w of shown) {
      const entries = await ctx.db
        .query("revenueEntries")
        .withIndex("by_organization_id", (q) => q.eq("organizationId", w.organizationId))
        .take(500);
      const usage = await ctx.db
        .query("voiceUsage")
        .withIndex("by_organization_id", (q) => q.eq("organizationId", w.organizationId))
        .take(1000);
      const inPeriod = (t: number) => t >= w.periodStart && t < w.periodEnd;
      const accounting = computeOrgAccounting({
        entries: entries.filter((e) => inPeriod(e.occurredAt)),
        usage: usage.filter((u) => inPeriod(u.endedAtMs ?? u.createdAt)),
        allocation,
      });
      walletRemaining += Math.max(0, w.budgetMicro - w.spentMicro);
      reserved += w.reservedMicro;
      totals.netCollectedMicro += accounting.netCollectedMicro;
      totals.vapiExpenseKnownMicro += accounting.vapiExpenseKnownMicro;
      totals.contributionMicro += accounting.contributionMicro;
      totals.pendingCostCalls += accounting.pendingCostCalls;
      organizations.push({
        organizationId: w.organizationId,
        periodStart: w.periodStart,
        wallet: { budgetMicro: w.budgetMicro, spentMicro: w.spentMicro, reservedMicro: w.reservedMicro },
        overBudget: w.spentMicro > w.budgetMicro,
        nearBudget: w.budgetMicro > 0 && w.spentMicro + w.reservedMicro >= Math.floor(w.budgetMicro * 0.8),
        accounting,
      });
    }

    const [pendingExpenses, expired, unreservedCalls] = await Promise.all([
      ctx.db.query("providerExpenses").withIndex("by_cost_status", (q) => q.eq("costStatus", "pending")).take(200),
      ctx.db.query("voiceCallReservations").withIndex("by_status_and_hold_deadline", (q) => q.eq("status", "expired_no_report")).take(200),
      ctx.db.query("voiceUsage").order("desc").take(500),
    ]);

    return {
      truncated,
      provider: {
        balanceMicro: account?.balanceMicro ?? null,
        // Only a manual figure exists today; a verified provider balance source is not implemented.
        balanceSource: account?.balanceSource ?? null,
        paused: account?.paused ?? false,
        lowBalance:
          account?.balanceMicro !== undefined &&
          account.lowBalanceThresholdMicro !== undefined &&
          account.balanceMicro <= account.lowBalanceThresholdMicro,
      },
      allocation,
      audit: (await ctx.db.query("adminAuditLog").withIndex("by_created_at").order("desc").take(20)).map((a) => ({
        at: a.createdAt, actor: a.actorUserId, action: a.action, target: a.targetId,
      })),
      liabilities: { walletRemainingMicro: walletRemaining, reservedMicro: reserved },
      totals,
      reconciliation: {
        pendingCostExpenses: pendingExpenses.length,
        expiredHoldsWithoutReport: expired.length,
        unreservedCalls: unreservedCalls.filter((u) => u.unreserved).length,
        callsWithOverrides: unreservedCalls.filter((u) => u.overridesDetected).length,
      },
      costAlerts: await ctx.db
        .query("voiceCostAlerts")
        .withIndex("by_created_at")
        .order("desc")
        .take(100),
      organizations,
    };
  },
});
