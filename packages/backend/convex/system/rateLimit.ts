import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { takeTokens } from "../lib/rateLimit";

/** For actions, which cannot touch the database directly. Returns, never throws. */
export const take = internalMutation({
  args: { key: v.string(), capacity: v.number(), refillPerSecond: v.number(), cost: v.optional(v.number()) },
  handler: async (ctx, args) =>
    takeTokens(ctx, args.key, { capacity: args.capacity, refillPerSecond: args.refillPerSecond }, args.cost ?? 1),
});
