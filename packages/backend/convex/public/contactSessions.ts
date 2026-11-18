
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action, mutation } from "../_generated/server";
import { isContactSessionActive } from "../lib/contactSessionPolicy";
import { RATE, INPUT, assertText, assertEmail, assertOrgId } from "../lib/limits";
import { verifyWidgetInstallToken } from "../lib/widgetOrigin";
import { rateLimited } from "../lib/rateLimit";
import type { Id } from "../_generated/dataModel";

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
 * Verify the signed installation token and current origin allowlist before
 * creating a visitor session. The database write stays internal.
 */
export const create = action({
  args: {
    name: v.string(),
    email: v.string(),
    organizationId: v.string(),
    installToken: v.string(),
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
    const claims = await verifyWidgetInstallToken(args.installToken, organizationId);
    const installation = await ctx.runQuery(internal.system.widgetInstallations.getConfig, { organizationId });
    if (!installation || !installation.allowedOrigins.includes(claims.origin)) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "This website is not authorized to use this widget." });
    }

    return await ctx.runMutation(
      internal.system.contactSessions.create,
      { name, email, organizationId, installationOrigin: claims.origin, metadata: args.metadata },
    );
  },
});

/**
 * Expose validity only, never visitor information.
 */
export const validate = mutation({
  args: {
    contactSessionId: v.id("contactSessions"),
    installToken: v.string(),
  },
  handler: async (ctx, args): Promise<{ valid: boolean }> => {
    const contactSession = await ctx.db.get(args.contactSessionId);

    if (
      !contactSession ||
      !isContactSessionActive(contactSession.expiresAt, Date.now())
    ) {
      return { valid: false };
    }

    const claims = await verifyWidgetInstallToken(args.installToken, contactSession.organizationId);
    const organization = await ctx.db.query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", contactSession.organizationId))
      .first();
    const settings = await ctx.db.query("widgetSettings")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", contactSession.organizationId))
      .unique();
    if (organization?.status !== "active" || !contactSession.installationOrigin || claims.origin !== contactSession.installationOrigin || !(settings?.allowedOrigins ?? []).includes(claims.origin)) return { valid: false };

    return { valid: true };
  },
});
