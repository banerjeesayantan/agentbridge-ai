import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { isMicro } from "../lib/money";

/**
 * Revenue accounting from VERIFIED Polar order events (the webhook has already
 * checked the signature). Never funded from a checkout redirect: only a paid
 * order event produces a revenue entry.
 *
 * Idempotency is by content, not by delivery: each entry has a deterministic
 * key (`payment:<order>`, `fee:<order>`, `refund:<order>:<cumulative>`), so a
 * redelivered or out-of-order event cannot record anything twice. Refunds are
 * cumulative in Polar's order object, so only the DELTA over what is already
 * recorded becomes a new refund entry.
 */

async function insertEntry(
  ctx: MutationCtx,
  entry: {
    key: string;
    polarOrderId: string;
    organizationId: string;
    kind: "payment" | "refund" | "platform_fee";
    amountMicro: number;
    occurredAt: number;
  },
): Promise<boolean> {
  const existing = await ctx.db
    .query("revenueEntries")
    .withIndex("by_event_key", (q) => q.eq("eventKey", entry.key))
    .first();
  if (existing) return false;
  await ctx.db.insert("revenueEntries", {
    eventKey: entry.key,
    polarOrderId: entry.polarOrderId,
    organizationId: entry.organizationId,
    kind: entry.kind,
    amountMicro: entry.amountMicro,
    currency: "usd",
    occurredAt: entry.occurredAt,
    createdAt: Date.now(),
  });
  return true;
}

export const applyPolarOrderEvent = internalMutation({
  args: {
    polarOrderId: v.string(),
    organizationId: v.string(),
    type: v.union(v.literal("order.paid"), v.literal("order.refunded")),
    netMicro: v.number(),
    refundedTotalMicro: v.number(),
    feeMicro: v.optional(v.number()),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    for (const n of [args.netMicro, args.refundedTotalMicro, args.feeMicro]) {
      if (n !== undefined && !isMicro(n)) return { ok: false as const, code: "INVALID" as const };
    }

    // An order belongs to exactly one organization; never let a later event move it.
    const prior = await ctx.db
      .query("revenueEntries")
      .withIndex("by_polar_order_id", (q) => q.eq("polarOrderId", args.polarOrderId))
      .take(50);
    if (prior.some((e) => e.organizationId !== args.organizationId)) {
      console.error("ALERT: Polar order seen under two organizations; event rejected", {
        polarOrderId: args.polarOrderId,
      });
      return { ok: false as const, code: "WRONG_ORGANIZATION" as const };
    }

    const base = { polarOrderId: args.polarOrderId, organizationId: args.organizationId, occurredAt: args.occurredAt };
    let recorded = 0;

    if (args.type === "order.paid") {
      if (await insertEntry(ctx, { ...base, key: `payment:${args.polarOrderId}`, kind: "payment", amountMicro: args.netMicro })) {
        recorded++;
      }
      if (args.feeMicro !== undefined) {
        if (await insertEntry(ctx, { ...base, key: `fee:${args.polarOrderId}`, kind: "platform_fee", amountMicro: args.feeMicro })) {
          recorded++;
        }
      }
    }

    // A refund event may arrive before, after, or without the paid event.
    const recordedRefunds = prior.filter((e) => e.kind === "refund").reduce((sum, e) => sum + e.amountMicro, 0);
    const delta = args.refundedTotalMicro - recordedRefunds;
    if (delta > 0) {
      if (
        await insertEntry(ctx, {
          ...base,
          key: `refund:${args.polarOrderId}:${args.refundedTotalMicro}`,
          kind: "refund",
          amountMicro: delta,
        })
      ) {
        recorded++;
      }
    }

    return { ok: true as const, recorded };
  },
});
