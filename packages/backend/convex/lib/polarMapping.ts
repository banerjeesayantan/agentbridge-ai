import { planForProductId } from "./polarConfig";

export interface AppliedSubscriptionEvent {
  eventId: string;
  organizationId: string;
  polarSubscriptionId: string;
  polarCustomerId?: string;
  polarProductId?: string;
  polarPriceId?: string;
  plan?: "pro" | "enterprise";
  status: string;
  interval?: string;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd: boolean;
  modifiedAt: number;
}

const toMs = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
};

/**
 * Convert a verified Polar `subscription.*` event into our normalized shape.
 * Accepts SDK camelCase and raw snake_case. Returns null when the event
 * cannot be tied to an organization we created the customer for.
 */
export function mapSubscriptionEvent(
  type: string,
  data: any,
  eventId: string,
  now: number,
): AppliedSubscriptionEvent | null {
  if (!type.startsWith("subscription.") || !data) return null;

  const customer = data.customer ?? {};
  const organizationId: unknown =
    customer.externalId ?? customer.external_id ?? data.metadata?.organizationId ?? customer.metadata?.organizationId;
  const subscriptionId: unknown = data.id;
  if (typeof organizationId !== "string" || !organizationId || typeof subscriptionId !== "string") return null;

  const productId: string | undefined = data.productId ?? data.product_id ?? data.product?.id;
  const price = data.prices?.[0] ?? data.price;
  // `subscription.revoked` means access ends now, whatever the payload status says.
  const status: string = type === "subscription.revoked" ? "revoked" : String(data.status ?? "unknown");

  return {
    eventId,
    organizationId,
    polarSubscriptionId: subscriptionId,
    polarCustomerId: data.customerId ?? data.customer_id ?? customer.id,
    polarProductId: productId,
    polarPriceId: price?.id,
    plan: planForProductId(productId),
    status,
    interval: data.recurringInterval ?? data.recurring_interval,
    currentPeriodStart: toMs(data.currentPeriodStart ?? data.current_period_start),
    currentPeriodEnd: toMs(data.currentPeriodEnd ?? data.current_period_end),
    cancelAtPeriodEnd: Boolean(data.cancelAtPeriodEnd ?? data.cancel_at_period_end),
    modifiedAt: toMs(data.modifiedAt ?? data.modified_at) ?? toMs(data.createdAt ?? data.created_at) ?? now,
  };
}
