import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { financeTables } from "./schema.finance";
export default defineSchema({
  subscriptions: defineTable({
    organizationId: v.string(),
    // Polar subscription status (active, trialing, past_due, canceled, revoked, ...)
    status: v.string(),
    // Normalized plan; absent/unknown always resolves to Free.
    plan: v.optional(v.union(v.literal("pro"), v.literal("enterprise"))),
    polarCustomerId: v.optional(v.string()),
    polarSubscriptionId: v.optional(v.string()),
    polarProductId: v.optional(v.string()),
    polarPriceId: v.optional(v.string()),
    interval: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    // When the first failed payment was seen; starts the grace period.
    pastDueSince: v.optional(v.number()),
    // Polar's modified_at of the last applied event (out-of-order protection).
    polarModifiedAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_polar_subscription_id", ["polarSubscriptionId"]),
  // Webhook deliveries already processed (idempotency).
  webhookEvents: defineTable({
    eventId: v.string(),
    type: v.string(),
    receivedAt: v.number(),
  }).index("by_event_id", ["eventId"]),
  // Per-organization counters, one row per metric per usage period.
  usage: defineTable({
    organizationId: v.string(),
    metric: v.literal("aiMessages"),
    periodStart: v.number(),
    count: v.number(),
  }).index("by_org_metric_period", ["organizationId", "metric", "periodStart"]),
  // Request IDs already counted, so retries never double-count.
  usageEvents: defineTable({
    organizationId: v.string(),
    requestId: v.string(),
    operationKey: v.optional(v.string()),
    metric: v.optional(v.literal("aiMessages")),
    units: v.optional(v.number()),
    // Absent on legacy rows, which behave as "committed".
    status: v.optional(v.union(v.literal("committed"), v.literal("refunded"))),
    // Billing period the units were counted in (needed to refund the right row).
    periodStart: v.optional(v.number()),
  }).index("by_org_request", ["organizationId", "requestId"]),
  widgetSettings: defineTable({
    organizationId: v.string(),
    // Exact browser origins allowed to install this public widget.
    allowedOrigins: v.optional(v.array(v.string())),
    greetMessage: v.string(),
    defaultSuggestions: v.object({
      suggestion1: v.optional(v.string()),
      suggestion2: v.optional(v.string()),
      suggestion3: v.optional(v.string()),
    }),
    vapiSettings: v.object({
      assistantId: v.optional(v.string()),
      phoneNumber: v.optional(v.string()),
    }),
  })
  .index("by_organization_id", ["organizationId"]),
  plugins: defineTable({
    organizationId: v.string(),
    service: v.union(v.literal("vapi")),
    secretName: v.string(),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_organization_id_and_service", ["organizationId", "service"]),
  conversations: defineTable({
    threadId: v.string(),
    organizationId: v.string(),
    contactSessionId: v.id("contactSessions"),
    status: v.union(
      v.literal("unresolved"),
      v.literal("escalated"),
      v.literal("resolved")
    ),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_contact_session_id", ["contactSessionId"])
    .index("by_thread_id", ["threadId"])
    .index("by_status_and_organization_id", ["status", "organizationId"]),
  contactSessions: defineTable({
    name: v.string(),
    email: v.string(),
    organizationId: v.string(),
    expiresAt: v.number(),
    metadata: v.optional(v.object({
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
    }))
  })
  .index("by_organization_id", ["organizationId"])
  .index("by_expires_at", ["expiresAt"]),
  voiceTrials: defineTable({
    organizationId: v.string(),
    usedAt: v.number(),
  }).index("by_organization_id", ["organizationId"]),
  users: defineTable({
    name: v.string(),
  }),
  organizations: defineTable({
    clerkOrgId: v.string(),
    name: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("deleted")),
    updatedAt: v.number(),
  }).index("by_clerk_org_id", ["clerkOrgId"]),
  rateLimits: defineTable({
    key: v.string(),
    tokens: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_updated_at", ["updatedAt"]),
  fileUploads: defineTable({
    organizationId: v.string(),
    key: v.string(),
    createdAt: v.number(),
  })    .index("by_organization_id", ["organizationId"])
    .index("by_organization_id_and_created_at", ["organizationId", "createdAt"]),
  feedback: defineTable({
    organizationId: v.string(),
    conversationId: v.id("conversations"),
    threadId: v.string(),
    messageId: v.string(),
    rating: v.union(
      v.literal("positive"),
      v.literal("negative")
    ),
    comment: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_conversation", ["conversationId"])
    .index("by_organization_id", ["organizationId"])
    .index("by_organization_and_message", ["organizationId", "messageId"])
    .index("by_organization_and_created_at", ["organizationId", "createdAt"]),
  ...financeTables,
});

