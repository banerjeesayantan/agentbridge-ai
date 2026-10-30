import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { SESSION_DURATION_MS } from "../constants";
import { normalizeContactDetails } from "../lib/contactSessionPolicy";

const AUTO_REFRESH_THRESHOLD_MS = 4 * 60 * 60 * 1000;

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

/** Create a visitor session only after the public action verifies its org. */
export const create = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    organizationId: v.string(),
    metadata: metadataValidator,
  },
  handler: async (ctx, args) => {
    const { name, email } = normalizeContactDetails(args.name, args.email);

    const now = Date.now();
    const expiresAt = now + SESSION_DURATION_MS;

    return await ctx.db.insert("contactSessions", {
      name,
      email,
      organizationId: args.organizationId,
      expiresAt,
      metadata: args.metadata,
    });
  },
});

export const refresh = internalMutation({
  args: {
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args) => {
    const contactSession = await ctx.db.get(args.contactSessionId);

    if (!contactSession) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Contact session not found",
      });
    }

    if (contactSession.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Contact session expired",
      });
    }

    const timeRemaining = contactSession.expiresAt - Date.now();

    if (timeRemaining < AUTO_REFRESH_THRESHOLD_MS) {
      const newExpiresAt = Date.now() + SESSION_DURATION_MS;

      await ctx.db.patch(args.contactSessionId, {
        expiresAt: newExpiresAt,
      });

      return { ...contactSession, expiresAt: newExpiresAt };
    }

    return contactSession;
  },
});

export const getOne = internalQuery({
  args: {
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.contactSessionId);
  },
});
