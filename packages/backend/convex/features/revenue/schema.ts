import { defineTable } from "convex/server";
import { v } from "convex/values";

export const revenueTables = {
  revenueEntries: defineTable({
    eventKey: v.string(),
    polarOrderId: v.string(),
    organizationId: v.string(),
    kind: v.union(v.literal("payment"), v.literal("refund"), v.literal("platform_fee")),
    amountMicro: v.number(),
    currency: v.string(),
    occurredAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_event_key", ["eventKey"])
    .index("by_polar_order_id", ["polarOrderId"])
    .index("by_organization_id", ["organizationId"]),
  revenueAllocationSettings: defineTable({
    key: v.literal("default"),
    parts: v.array(v.object({ key: v.string(), bps: v.number() })),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_key", ["key"]),
};
