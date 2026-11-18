import { requireOrg } from "../../../lib/auth";
import { ConvexError } from "convex/values";
import { query } from "../../../_generated/server";
import { getEntitlements } from "../../../lib/entitlements";
import { readVoiceBudgetConfig } from "../lib/voiceBudget";

/**
 * Customer-facing voice budget. Scoped to the caller's own organization (from
 * the verified identity, never an argument). It exposes this organization's
 * allowance and usage only: no provider balance, no other organization's
 * wallet, no platform revenue or profit.
 */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const { orgId: organizationId } = await requireOrg(ctx);

    const ent = await getEntitlements(ctx, organizationId);
    const cfg = readVoiceBudgetConfig(process.env);
    const paidPlan = ent.plan === "pro" || ent.plan === "enterprise";

    const control = await ctx.db
      .query("orgVoiceControls")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", organizationId))
      .first();
    const assistant = await ctx.db
      .query("managedAssistants")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", organizationId))
      .first();

    const wallet = await ctx.db
      .query("voiceWallets")
      .withIndex("by_organization_id_and_period_start", (q) =>
        q.eq("organizationId", organizationId).eq("periodStart", ent.periodStart),
      )
      .unique();

const budgetPlan = ent.plan === "enterprise" ? "enterprise" : "pro";
const planBudget = paidPlan ? cfg.planBudgetMicro[budgetPlan] : 0;    
const budgetMicro = Math.max(wallet?.budgetMicro ?? 0, planBudget);
    const spentMicro = wallet?.spentMicro ?? 0;
    const reservedMicro = wallet?.reservedMicro ?? 0;

    const recent = await ctx.db
      .query("voiceUsage")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", organizationId))
      .order("desc")
      .take(20);

    let status: "available" | "plan_required" | "suspended" | "not_set_up" | "budget_used";
    if (!paidPlan || !ent.limits.voice) status = "plan_required";
    else if (control?.suspended) status = "suspended";
    else if (!assistant) status = "not_set_up";
    else if (budgetMicro - spentMicro - reservedMicro <= 0) status = "budget_used";
    else status = "available";

    return {
      plan: ent.plan,
      status,
      periodStart: ent.periodStart,
      periodEnd: ent.periodEnd,
      budgetMicro,
      spentMicro,
      reservedMicro,
      remainingMicro: Math.max(0, budgetMicro - spentMicro - reservedMicro),
      pendingCostCalls: recent.filter((u) => u.costStatus === "pending").length,
      recentCalls: recent.map((u) => ({
        endedAtMs: u.endedAtMs ?? u.createdAt,
        durationSeconds: u.durationSeconds ?? null,
        chargeMicro: u.customerChargeMicro ?? null,
        costStatus: u.costStatus,
      })),
    };
  },
});
