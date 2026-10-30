import { createClerkClient } from "@clerk/backend";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action, mutation } from "../_generated/server";

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
 * Public visitor entry point.
 *
 * Organization IDs are supplied by the embed snippet, so verify the ID with
 * Clerk before creating a visitor session. The database write itself remains
 * internal and cannot be called directly by an untrusted client.
 */
export const create = action({
  args: {
    name: v.string(),
    email: v.string(),
    organizationId: v.string(),
    metadata: metadataValidator,
  },
  handler: async (ctx, args) => {
    if (!clerkSecretKey) {
      throw new ConvexError({
        code: "SERVICE_UNAVAILABLE",
        message: "Organization verification is not configured.",
      });
    }

    try {
      await clerkClient.organizations.getOrganization({
        organizationId: args.organizationId,
      });
    } catch {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Invalid organization.",
      });
    }

    return await ctx.runMutation(internal.system.contactSessions.create, args);
  },
});

/**
 * The contact-session ID is a bearer capability. Return only validity state;
 * never expose the visitor's name, email, or browser metadata from this
 * public endpoint.
 */
export const validate = mutation({
  args: {
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args) => {
    const contactSession = await ctx.db.get(args.contactSessionId);

    if (!contactSession || contactSession.expiresAt <= Date.now()) {
      return { valid: false };
    }

    return { valid: true };
  },
});
