import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  subscriptions: defineTable({
    organizationId: v.string(),
    // Polar subscription status (active, trialing, past_due, canceled, revoked, ...)
    status: v.string(),
    // Normalized plan; absent/unknown always resolves to Free.
    plan: v.optional(v.union(v.literal("pro"), v.literal("business"))),
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
  }).index("by_org_request", ["organizationId", "requestId"]),
  widgetSettings: defineTable({
    organizationId: v.string(),
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
  users: defineTable({
    name: v.string(),
  }),
});
