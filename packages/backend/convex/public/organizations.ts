import { createClerkClient } from "@clerk/backend";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { RATE, assertOrgId } from "../lib/limits";
import { rateLimited } from "../lib/rateLimit";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY || "",
});

export const validate = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const organizationId = assertOrgId(args.organizationId);
    const gate = await ctx.runMutation(internal.system.rateLimit.take, {
      key: "clerk:lookups:global",
      ...RATE.clerkLookupGlobal,
    });
    if (!gate.ok) rateLimited(gate.retryAfterMs);
    try {
      await clerkClient.organizations.getOrganization({ organizationId });
      return { valid: true };
    } catch {
      return { valid: false, reason: "Organization not valid" };
    }
  },
});
