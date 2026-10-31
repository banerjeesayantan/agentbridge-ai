import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { getEntitlements } from "../lib/entitlements";

const SCAN_CAP = 5000;

async function requireOrg(ctx: { auth: { getUserIdentity: () => Promise<any> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new ConvexError({ code: "UNAUTHORIZED", message: "Identity not found" });
  const orgId = identity.orgId as string;
  if (!orgId) throw new ConvexError({ code: "UNAUTHORIZED", message: "Organization not found" });
  return orgId;
}

/** Feedback totals and recent items for the caller's organization only. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrg(ctx);
    const ent = await getEntitlements(ctx, orgId);

    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", orgId))
      .order("desc")
      .take(SCAN_CAP);

    const positive = rows.filter((r) => r.rating === "positive").length;
    const negative = rows.length - positive;
    const advanced = ent.limits.advancedFeedback;

    return {
      total: rows.length,
      positive,
      negative,
      positivePct: rows.length ? Math.round((positive / rows.length) * 100) : null,
      truncated: rows.length === SCAN_CAP,
      advanced,
      // Comments are an advanced-feedback feature; everyone sees ratings.
      recent: rows.slice(0, advanced ? 50 : 5).map((r) => ({
        id: r._id,
        conversationId: r.conversationId,
        rating: r.rating,
        comment: advanced ? r.comment ?? null : null,
        at: r.updatedAt,
      })),
    };
  },
});

/** Full export for reports (Pro and above). */
export const exportAll = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await requireOrg(ctx);
    const ent = await getEntitlements(ctx, orgId);
    if (!ent.limits.advancedFeedback) {
      throw new ConvexError({
        code: "PLAN_REQUIRED",
        message: "Feedback reports are available on Pro and above. Upgrade to export.",
      });
    }
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", orgId))
      .order("desc")
      .take(SCAN_CAP);
    return rows.map((r) => ({
      conversationId: r.conversationId as string,
      rating: r.rating,
      comment: r.comment ?? "",
      at: new Date(r.updatedAt).toISOString(),
    }));
  },
});
