import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { getEntitlements } from "../lib/entitlements";

export const upsert = mutation({
  args: {
    service: v.union(v.literal("vapi")),
    value: v.any(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
        
    if (identity === null) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Identity not found",
      });
    }

    const orgId = identity.orgId as string;

    if (!orgId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Organization not found",
      });
    }

    const entitlements = await getEntitlements(ctx, orgId);

    if (!entitlements.limits.voice) {
      throw new ConvexError({
        code: "PLAN_REQUIRED",
        message: "The voice assistant is not included in your current plan. Upgrade to enable it.",
      });
    }

    await ctx.scheduler.runAfter(0, internal.system.secrets.upsert, {
      service: args.service,
      organizationId: orgId,
      value: args.value,
    });
  },
});
