import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { getEntitlements } from "../lib/entitlements";

async function requireOrganization(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Identity not found.",
    });
  }

  const organizationId = identity.orgId as string;

  if (!organizationId) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Organization not found.",
    });
  }

  return organizationId;
}

export const summary = query({
  args: {},

  handler: async (ctx) => {
    const organizationId = await requireOrganization(ctx);
    const entitlements = await getEntitlements(ctx, organizationId);

    // Bound the dashboard query to prevent unbounded reads.
    const fetched = await ctx.db
      .query("feedback")
      .withIndex("by_organization_and_created_at", (q) =>
        q.eq("organizationId", organizationId),
      )
      .order("desc")
      .take(5001);

    const truncated = fetched.length > 5000;
    const records = fetched.slice(0, 5000);

    const positive = records.filter(
      (item) => item.rating === "positive",
    ).length;

    const negative = records.filter(
      (item) => item.rating === "negative",
    ).length;

    const total = records.length;
    const advanced = entitlements.plan !== "free";

    const recentRecords = advanced
      ? records.filter((item) => Boolean(item.comment)).slice(0, 50)
      : records.slice(0, 5);

    return {
      total,
      positive,
      negative,
      positivePct: total > 0 ? Math.round((positive / total) * 100) : 0,
      truncated,
      advanced,
      recent: recentRecords.map((item) => ({
        id: item._id,
        rating: item.rating,
        comment: item.comment ?? null,
        at: item.createdAt,
        conversationId: item.conversationId,
      })),
    };
  },
});

export const exportAll = query({
  args: {},

  handler: async (ctx) => {
    const organizationId = await requireOrganization(ctx);
    const entitlements = await getEntitlements(ctx, organizationId);

    if (entitlements.plan === "free") {
      throw new ConvexError({
        code: "PLAN_REQUIRED",
        message:
          "Feedback CSV export is available on Pro and Enterprise plans.",
      });
    }

    const records = await ctx.db
      .query("feedback")
      .withIndex("by_organization_and_created_at", (q) =>
        q.eq("organizationId", organizationId),
      )
      .order("desc")
      .take(5000);

    return records.map((item) => ({
      id: item._id,
      conversationId: item.conversationId,
      rating: item.rating,
      comment: item.comment ?? "",
      time: item.createdAt,
    }));
  },
});
