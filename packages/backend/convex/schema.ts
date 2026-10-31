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
  // Old Polar subscriptions that have been replaced and must never become
  // current again for the organization.
  supersededSubscriptions: defineTable({
    organizationId: v.string(),
    polarSubscriptionId: v.string(),
    supersededAt: v.number(),
  })
    .index(
      "by_organization_id_and_polar_subscription_id",
      ["organizationId", "polarSubscriptionId"],
    )
    // Ownership guard: find a superseded ID regardless of organization.
    .index("by_polar_subscription_id", ["polarSubscriptionId"]),
  // Webhook deliveries already processed (idempotency).
  webhookEvents: defineTable({
    eventId: v.string(),
    type: v.string(),
    receivedAt: v.number(),
  }).index("by_event_id", ["eventId"]),
  // Verified webhook events that could not be applied; retained for
  // reconciliation. Field names/types only: never raw payloads, signatures
  // or secrets.
  webhookFailures: defineTable({
    eventId: v.string(),
    type: v.string(),
    reason: v.union(
      v.literal("malformed-linked-event"),
      v.literal("wrong-organization"),
    ),
    organizationId: v.optional(v.string()),
    polarSubscriptionId: v.optional(v.string()),
    // Sanitized shape summary: field name -> JS type or "missing". No values.
    detail: v.optional(v.record(v.string(), v.string())),
    status: v.union(v.literal("open"), v.literal("resolved")),
    receivedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_event_id", ["eventId"])
    .index("by_status_and_received_at", ["status", "receivedAt"])
    .index("by_organization_id", ["organizationId"]),
  // Pending Clerk membership-cap synchronization, one row per organization.
  // Stores NO cap value: every attempt reads current entitlements, so a stale
  // cap is never written to Clerk.
  clerkSyncTasks: defineTable({
    organizationId: v.string(),
    status: v.union(
      v.literal("pending"), // waiting for the next attempt
      v.literal("failed"), // retries exhausted; needs manual attention
      v.literal("succeeded"), // last sync succeeded
    ),
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    // Short, sanitized reason (HTTP status or error class), not a full error body.
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_status_and_next_attempt_at", ["status", "nextAttemptAt"]),
  // Per-organization counters, one row per metric per usage period.
  usage: defineTable({
    organizationId: v.string(),
    metric: v.literal("aiMessages"),
    periodStart: v.number(),
    count: v.number(),
  }).index("by_org_metric_period", ["organizationId", "metric", "periodStart"]),
  // Customer feedback on individual AI answers (one rating per message).
  feedback: defineTable({
    organizationId: v.string(),
    conversationId: v.id("conversations"),
    threadId: v.string(),
    messageId: v.string(),
    rating: v.union(v.literal("positive"), v.literal("negative")),
    comment: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_conversation_and_message", ["conversationId", "messageId"]),
  // Request IDs already counted, so retries never double-count.
  usageEvents: defineTable({
    organizationId: v.string(),
    requestId: v.string(),
  }).index("by_org_request", ["organizationId", "requestId"]),
  // ---- Free-plan voice demo (see lib/voiceDemo.ts) ----
  // One row per organization, ever. Inserted only after a successful session.
  voiceTrials: defineTable({
    organizationId: v.string(),
    sessionId: v.id("voiceSessions"),
    consumedAt: v.number(),
  }).index("by_organization_id", ["organizationId"]),
  // Configured-budget counters. provider = "global" or a provider id.
  voiceQuota: defineTable({
    provider: v.string(),
    periodKey: v.string(),
    reservedSeconds: v.number(),
    usedSeconds: v.number(),
  }).index("by_provider_period", ["provider", "periodKey"]),
  voiceSessions: defineTable({
    organizationId: v.string(),
    contactSessionId: v.id("contactSessions"),
    provider: v.string(),
    periodKey: v.string(),
    status: v.union(
      v.literal("reserved"), // capacity held, call not started
      v.literal("active"), // provider connected
      v.literal("completed"), // met success criteria; trial consumed
      v.literal("ended_short"), // started but did not meet criteria
      v.literal("released"), // never started / provider failed
      v.literal("expired"), // started, never reported; budget charged in full
    ),
    reservedSeconds: v.number(),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    chargedSeconds: v.optional(v.number()),
    providerCallId: v.optional(v.string()),
    fallbackCount: v.number(),
    triedProviders: v.array(v.string()),
    events: v.array(v.object({ at: v.number(), provider: v.string(), kind: v.string(), error: v.optional(v.string()) })),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_status_and_created_at", ["status", "createdAt"])
    // Match a provider's end-of-call report to its session (see applyCallReport).
    .index("by_provider_call_id", ["providerCallId"]),
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