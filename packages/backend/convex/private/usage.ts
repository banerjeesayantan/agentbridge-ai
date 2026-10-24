import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { getEntitlements, PLANS } from "../lib/entitlements";
import { countKnowledgeFiles } from "../lib/knowledgeFiles";
import { billingConfigured } from "../lib/polarConfig";

/** Plan, limits and consumption for the caller's current organization. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Identity not found" });
    }
    const orgId = identity.orgId as string;
    if (!orgId) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Organization not found" });
    }

    const ent = await getEntitlements(ctx, orgId);

    const row = await ctx.db
      .query("usage")
      .withIndex("by_org_metric_period", (q) =>
        q.eq("organizationId", orgId).eq("metric", "aiMessages").eq("periodStart", ent.periodStart),
      )
      .unique();

    const files = await countKnowledgeFiles(ctx, orgId, ent.limits.knowledgeFiles + 1);

    return {
      plan: ent.plan,
      planName: ent.planName,
      status: ent.status,
      cancelAtPeriodEnd: ent.cancelAtPeriodEnd,
      pastDue: ent.pastDue,
      graceEndsAt: ent.graceEndsAt,
      resetsAt: ent.periodEnd,
      limits: ent.limits,
      usage: { aiMessages: row?.count ?? 0, knowledgeFiles: files },
      plans: PLANS,
      billingConfigured: billingConfigured(),
    };
  },
});
