/**
 * Parse a verified Polar `order.paid` / `order.refunded` event into revenue facts.
 * Pure. Field names follow Polar's documented Order object: `net_amount` (cents,
 * after discounts, before tax), `refunded_amount` (cents), `platform_fee_amount`
 * (cents), `currency`, `status`, `customer.external_id`.
 *
 * What is NOT assumed:
 *  - tax is never revenue (net_amount excludes it);
 *  - the platform fee is Polar's reported figure; card-processing fees are not
 *    separately reported, so a missing fee stays missing, never zero;
 *  - no currency conversion: anything but USD is rejected, not guessed;
 *  - Polar documents no chargeback/dispute webhook, so chargebacks are not
 *    accounted for automatically.
 * `refunded_amount` is treated as the net (pre-tax) refunded amount, in line
 * with Polar's description of `refundable_amount`; verify with a sandbox refund.
 */

const CENTS_TO_MICRO = 10_000;
const ORG_ID_PATTERN = /^org_[A-Za-z0-9]{1,128}$/;
const ID_MAX = 200;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const cents = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;

export interface ParsedPolarOrder {
  polarOrderId: string;
  organizationId: string;
  type: "order.paid" | "order.refunded";
  /** Net collected (after discounts, before tax), micro-dollars. */
  netMicro: number;
  /** Cumulative net refunded so far, micro-dollars. */
  refundedTotalMicro: number;
  /** Polar's reported platform fee, micro-dollars. Undefined when not reported. */
  feeMicro?: number;
  currency: "usd";
  occurredAt: number;
}

export type PolarOrderParse =
  | { kind: "ignore" } // not an order event we account for
  | { kind: "unlinked" } // a customer that is not one of our organizations
  | { kind: "invalid"; reason: string }
  | { kind: "ok"; order: ParsedPolarOrder };

export function parsePolarOrderEvent(type: string, data: unknown, now: number): PolarOrderParse {
  if (type !== "order.paid" && type !== "order.refunded") return { kind: "ignore" };
  if (!isRecord(data)) return { kind: "invalid", reason: "missing data" };

  const customer = isRecord(data.customer) ? data.customer : {};
  const external = customer.externalId ?? customer.external_id;
  if (typeof external !== "string" || !ORG_ID_PATTERN.test(external)) return { kind: "unlinked" };

  const id = data.id;
  if (typeof id !== "string" || id.length === 0 || id.length > ID_MAX || id !== id.trim()) {
    return { kind: "invalid", reason: "invalid order id" };
  }

  const currency = typeof data.currency === "string" ? data.currency.toLowerCase() : "";
  if (currency !== "usd") return { kind: "invalid", reason: "unsupported currency" };

  const status = data.status;
  if (type === "order.paid" && !(status === "paid" || data.paid === true)) {
    return { kind: "invalid", reason: "order is not paid" };
  }
  if (type === "order.refunded" && status !== "refunded" && status !== "partially_refunded") {
    return { kind: "invalid", reason: "order is not refunded" };
  }

  const net = cents(data.net_amount ?? data.netAmount);
  if (net === undefined) return { kind: "invalid", reason: "invalid net amount" };
  const refunded = cents(data.refunded_amount ?? data.refundedAmount) ?? 0;
  const fee = cents(data.platform_fee_amount ?? data.platformFeeAmount);

  const stamp = Date.parse(String(data.modified_at ?? data.modifiedAt ?? data.created_at ?? data.createdAt ?? ""));
  return {
    kind: "ok",
    order: {
      polarOrderId: id,
      organizationId: external,
      type,
      netMicro: net * CENTS_TO_MICRO,
      refundedTotalMicro: refunded * CENTS_TO_MICRO,
      feeMicro: fee === undefined ? undefined : fee * CENTS_TO_MICRO,
      currency: "usd",
      occurredAt: Number.isFinite(stamp) ? stamp : now,
    },
  };
}
