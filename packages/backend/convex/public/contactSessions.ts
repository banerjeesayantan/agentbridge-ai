
import { createClerkClient } from "@clerk/backend";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action, mutation } from "../_generated/server";
import { isContactSessionActive } from "../lib/contactSessionPolicy";
import { RATE, INPUT, assertText, assertEmail, assertOrgId } from "../lib/limits";
import { rateLimited } from "../lib/rateLimit";
import type { Id } from "../_generated/dataModel";

const clerkSecretKey = process.env.CLERK_SECRET_KEY;

const clerkClient = createClerkClient({
  secretKey: clerkSecretKey || "",
});

const metadataValidator = v.optional(
  v.object({
    userAgent: v.optional(v.string()),
    language: v.optional(v.string()),
    languages: v.optional(v.string()),
    platform: v.optional(v.string()),
    vendor: v.optional(v.string()),
    screenResolution: v.optional(v.string()),
    viewportSize: v.optional(v.string()),
    timezone: v.optional(v.string()),
    timezoneOffset: v.optional(v.number()),
    cookieEnabled: v.optional(v.boolean()),
    referrer: v.optional(v.string()),
    currentUrl: v.optional(v.string()),
  }),
);

/**
 * Verify the organization with Clerk before creating a visitor session.
 * The database write is restricted to the internal mutation.
 */
export const create = action({
  args: {
    name: v.string(),
    email: v.string(),
    organizationId: v.string(),
    metadata: metadataValidator,
  },
  handler: async (ctx, args): Promise<Id<"contactSessions">> => {
    const name = assertText(args.name, INPUT.NAME_MAX, "name");
    const email = assertEmail(args.email);
    const organizationId = assertOrgId(args.organizationId);
    const gate = await ctx.runMutation(internal.system.rateLimit.take, {
      key: `session:create:org:${organizationId}`,
      ...RATE.sessionCreateOrg,
    });
    if (!gate.ok) rateLimited(gate.retryAfterMs);
    const globalGate = await ctx.runMutation(internal.system.rateLimit.take, {
      key: "clerk:lookups:global",
      ...RATE.clerkLookupGlobal,
    });
    if (!globalGate.ok) rateLimited(globalGate.retryAfterMs);

    if (!clerkSecretKey) {
      throw new ConvexError({
        code: "SERVICE_UNAVAILABLE",
        message: "Organization verification is not configured.",
      });
    }

    try {
      await clerkClient.organizations.getOrganization({
        organizationId,
      });
    } catch {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Invalid organization.",
      });
    }

    return await ctx.runMutation(
      internal.system.contactSessions.create,
      { ...args, name, email, organizationId },
    );
  },
});

/**
 * Expose validity only, never visitor information.
 */
export const validate = mutation({
  args: {
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args): Promise<{ valid: boolean }> => {
    const contactSession = await ctx.db.get(args.contactSessionId);

    if (
      !contactSession ||
      !isContactSessionActive(contactSession.expiresAt, Date.now())
    ) {
      return { valid: false };
    }

    return { valid: true };
  },
});
