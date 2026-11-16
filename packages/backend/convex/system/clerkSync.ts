import { createClerkClient } from "@clerk/backend";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

/** Push the plan's member cap to Clerk, retrying with backoff (idempotent). */
export const setMemberCap = internalAction({
  args: { organizationId: v.string(), memberCap: v.number(), attempt: v.number() },
  handler: async (ctx, args) => {
    const secretKey = process.env.CLERK_SECRET_KEY?.trim();
    if (!secretKey) {
      console.error("CONFIG: CLERK_SECRET_KEY missing; member cap not synced", { organizationId: args.organizationId });
      return { ok: false as const };
    }
    try {
      const clerk = createClerkClient({ secretKey });
      await clerk.organizations.updateOrganization(args.organizationId, { maxAllowedMemberships: args.memberCap });
      return { ok: true as const };
    } catch (error) {
      const delay = BACKOFF_MS[args.attempt - 1];
      if (delay === undefined) {
        console.error("ALERT: Clerk member cap sync failed permanently", { organizationId: args.organizationId });
        return { ok: false as const };
      }
      console.error("Clerk member cap sync failed; retrying", { attempt: args.attempt, error: String(error).slice(0, 200) });
      await ctx.scheduler.runAfter(delay, internal.system.clerkSync.setMemberCap, { ...args, attempt: args.attempt + 1 });
      return { ok: false as const };
    }
  },
});
