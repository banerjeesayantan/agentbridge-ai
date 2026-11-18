import { defineTable } from "convex/server";
import { v } from "convex/values";

export const voiceTables = {
  voiceWallets: defineTable({
    organizationId: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
    budgetMicro: v.number(),
    reservedMicro: v.number(),
    spentMicro: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization_id_and_period_start", ["organizationId", "periodStart"]),
  voiceWalletTransactions: defineTable({
    walletId: v.id("voiceWallets"),
    organizationId: v.string(),
    type: v.union(v.literal("grant"), v.literal("reserve"), v.literal("release"), v.literal("settle")),
    amountMicro: v.number(),
    idempotencyKey: v.string(),
    reservationId: v.optional(v.id("voiceCallReservations")),
    providerCallId: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_wallet_id", ["walletId"]),
  voiceCallReservations: defineTable({
    organizationId: v.string(),
    contactSessionId: v.id("contactSessions"),
    walletId: v.id("voiceWallets"),
    assistantId: v.string(),
    reservedMicro: v.number(),
    status: v.union(
      v.literal("authorized"), // token issued; a call may exist until holdDeadline
      v.literal("settled"), // provider report received, cost known
      v.literal("pending_cost"), // call ended but cost unknown: hold kept until reconciled
      v.literal("expired_no_report"), // deadline passed with no provider event
      v.literal("released_unissued"), // token could not be issued; no call possible
    ),
    tokenExpiresAt: v.number(),
    holdDeadline: v.number(),
    maxCallSeconds: v.number(),
    providerCallId: v.optional(v.string()),
    createdAt: v.number(),
    settledAt: v.optional(v.number()),
  })
    .index("by_organization_id_and_status", ["organizationId", "status"])
    .index("by_status_and_hold_deadline", ["status", "holdDeadline"])
    .index("by_contact_session_id", ["contactSessionId"])
    .index("by_provider_call_id", ["providerCallId"]),
  unboundVoiceReports: defineTable({
    providerCallId: v.string(),
    assistantId: v.string(),
    organizationId: v.string(),
    costMicro: v.optional(v.number()),
    rawCostUsd: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    startedAtMs: v.optional(v.number()),
    endedAtMs: v.optional(v.number()),
    endedReason: v.optional(v.string()),
    overridesDetected: v.boolean(),
    status: v.union(v.literal("pending"), v.literal("settled"), v.literal("unmatched")),
    receivedAt: v.number(),
  })
    .index("by_provider_call_id", ["providerCallId"])
    .index("by_status_and_received_at", ["status", "receivedAt"]),
  voiceUsage: defineTable({
    organizationId: v.string(),
    providerCallId: v.string(),
    assistantId: v.string(),
    walletId: v.optional(v.id("voiceWallets")),
    reservationId: v.optional(v.id("voiceCallReservations")),
    costStatus: v.union(v.literal("known"), v.literal("pending")),
    // Actual provider cost (what the platform pays Vapi). Absent while pending: never zero.
    costMicro: v.optional(v.number()),
    // Allowance debited from the organization's voice wallet. Under the flat-subscription
    // model this equals the actual provider cost; it is absent while the cost is pending.
    customerChargeMicro: v.optional(v.number()),
    rawCostUsd: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    startedAtMs: v.optional(v.number()),
    endedAtMs: v.optional(v.number()),
    endedReason: v.optional(v.string()),
    overridesDetected: v.boolean(),
    // A call that matched no open reservation (cost is still recorded).
    unreserved: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_provider_call_id", ["providerCallId"])
    .index("by_organization_id", ["organizationId"]),
  providerExpenses: defineTable({
    kind: v.union(v.literal("paid_call"), v.literal("free_demo")),
    providerCallId: v.string(),
    organizationId: v.optional(v.string()),
    costStatus: v.union(v.literal("known"), v.literal("pending")),
    costMicro: v.optional(v.number()),
    // The call matched no verified reservation: recorded for reconciliation,
    // never debited from any tenant wallet automatically.
    unmatched: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_provider_call_id", ["providerCallId"])
    .index("by_cost_status", ["costStatus"]),
  providerAccount: defineTable({
    key: v.literal("central"),
    balanceMicro: v.optional(v.number()),
    // "manual" until a verified provider balance source exists.
    balanceSource: v.optional(v.union(v.literal("manual"), v.literal("verified"))),
    lowBalanceThresholdMicro: v.optional(v.number()),
    paused: v.boolean(),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_key", ["key"]),
  orgVoiceControls: defineTable({
    organizationId: v.string(),
    suspended: v.boolean(),
    reason: v.optional(v.string()),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_organization_id", ["organizationId"]),
  adminAuditLog: defineTable({
    actorUserId: v.string(),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    detail: v.optional(v.record(v.string(), v.string())),
    createdAt: v.number(),
  }).index("by_created_at", ["createdAt"]),
  processedProviderEvents: defineTable({
    eventKey: v.string(),
    provider: v.string(),
    receivedAt: v.number(),
  }).index("by_event_key", ["eventKey"]),
  managedAssistants: defineTable({
    organizationId: v.string(),
    vapiAssistantId: v.string(),
    createdAt: v.number(),
    createdBy: v.string(),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_vapi_assistant_id", ["vapiAssistantId"]),
  voiceCostAlerts: defineTable({
    organizationId: v.string(),
    providerCallId: v.string(),
    reservationId: v.id("voiceCallReservations"),
    alertType: v.union(
      v.literal("RESERVATION_OVERRUN"),
      v.literal("BUDGET_EXCEEDED"),
    ),
    reservedMicro: v.number(),
    actualCostMicro: v.number(),
    budgetMicro: v.number(),
    resultingSpentMicro: v.number(),
    idempotencyKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_created_at", ["createdAt"])
    .index("by_organization_id", ["organizationId"]),
  voiceTrials: defineTable({
    organizationId: v.string(),
    usedAt: v.number(),
  }).index("by_organization_id", ["organizationId"]),
};
