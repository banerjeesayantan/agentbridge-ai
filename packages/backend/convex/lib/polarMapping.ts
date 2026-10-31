import { planForProductId } from "./polarConfig";

export interface AppliedSubscriptionEvent {
  eventId: string;
  organizationId: string;
  polarSubscriptionId: string;
  polarCustomerId?: string;
  polarProductId?: string;
  polarPriceId?: string;
  plan?: "pro" | "business";
  status: string;
  interval?: string;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd: boolean;
  modifiedAt: number;
}

/**
 * Subscription events we act on (the full set Polar documents). Anything else,
 * including a future event we have not reviewed, is ignored.
 */
const SUPPORTED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.past_due",
  "subscription.revoked",
]);

const MAX_ID_LENGTH = 200;
const MAX_STATUS_LENGTH = 64;

/**
 * Clerk organization IDs. Anything else is never accepted as an organization,
 * so a malformed or hostile value cannot reach the database.
 */
const ORG_ID_PATTERN = /^org_[A-Za-z0-9]{1,128}$/;

/** Timestamps outside this window are treated as invalid (this also rejects values in seconds). */
const MIN_PLAUSIBLE_MS = Date.UTC(2020, 0, 1);
const MAX_PLAUSIBLE_MS = Date.UTC(2100, 0, 1);

/** How far ahead of our clock an event's modified time may be before we refuse it. */
const MODIFIED_AT_SKEW_MS = 5 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

const isRecord = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A non-empty, bounded string with no surrounding whitespace; otherwise undefined. */
const cleanId = (value: unknown, max = MAX_ID_LENGTH): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim()
    ? value
    : undefined;

/**
 * Parse a timestamp into epoch milliseconds. Polar sends ISO strings; numbers
 * are accepted only if they are plausible milliseconds. A value in seconds
 * falls outside the window and is rejected rather than misread.
 */
const toMs = (value: unknown): number | undefined => {
  let ms: number | undefined;
  if (value instanceof Date) ms = value.getTime();
  else if (typeof value === "number") ms = value;
  else if (typeof value === "string") ms = Date.parse(value);

  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  return ms >= MIN_PLAUSIBLE_MS && ms <= MAX_PLAUSIBLE_MS ? ms : undefined;
};

/**
 * Convert a verified Polar `subscription.*` event into our normalized shape.
 * Accepts SDK camelCase and raw snake_case.
 *
 * Returns null (event is not applied) when it cannot be trusted or ordered:
 *  - the organization is not the customer's `external_id` (see below)
 *  - the subscription, customer or event ID is missing or malformed
 *  - the event type is not a supported subscription event
 *  - `cancel_at_period_end` is not a real boolean
 *  - no usable modified time exists, or it lies in the future
 *
 * Organization trust: the ONLY accepted source is the Polar customer's
 * `external_id`, which our server sets when it creates the checkout and which
 * Polar keeps unique per customer. Metadata is deliberately ignored, because it
 * can be supplied by whoever creates a checkout and a valid signature only
 * proves the event came from Polar, not that its metadata is true.
 *
 * An unknown or missing product does NOT cause rejection: the event is applied
 * with no plan, which resolves to Free. Dropping it instead would leave an old
 * paid plan active after a switch to an unrecognized product.
 *
 * Callers should log when this returns null for a `subscription.*` event, so a
 * payload-shape change is noticed instead of silently ignored.
 */
export function mapSubscriptionEvent(
  type: string,
  data: unknown,
  eventId: string,
  now: number,
): AppliedSubscriptionEvent | null {
  if (!SUPPORTED_EVENT_TYPES.has(type) || !isRecord(data)) return null;

  const safeEventId = cleanId(eventId);
  if (!safeEventId) return null;

  const customer: Obj = isRecord(data.customer) ? data.customer : {};

  const externalId = customer.externalId ?? customer.external_id;
  if (typeof externalId !== "string" || !ORG_ID_PATTERN.test(externalId)) return null;
  const organizationId = externalId;

  const subscriptionId = cleanId(data.id);
  if (!subscriptionId) return null;

  const customerId = cleanId(data.customerId ?? data.customer_id ?? customer.id);
  if (!customerId) return null;

  // Polar sends `modified_at: null` for a subscription that has never been
  // modified, so `created_at` is then its true last-change time. A value that is
  // present but invalid is never replaced by `created_at`: that could make a
  // newer event look old.
  const rawModifiedAt = data.modifiedAt ?? data.modified_at;
  const modifiedAt =
    rawModifiedAt === null || rawModifiedAt === undefined
      ? toMs(data.createdAt ?? data.created_at)
      : toMs(rawModifiedAt);
  if (modifiedAt === undefined || modifiedAt > now + MODIFIED_AT_SKEW_MS) return null;

  // Must be a real boolean: Boolean("false") would be true.
  const cancelAtPeriodEnd = data.cancelAtPeriodEnd ?? data.cancel_at_period_end;
  if (typeof cancelAtPeriodEnd !== "boolean") return null;

  const productId = cleanId(data.productId ?? data.product_id ?? data.product?.id);
  const price = data.prices?.[0] ?? data.price;

  // `subscription.revoked` means access ends now, whatever the payload status says.
  const rawStatus = cleanId(data.status, MAX_STATUS_LENGTH);
  const status = type === "subscription.revoked" ? "revoked" : (rawStatus ?? "unknown");

  let currentPeriodStart = toMs(data.currentPeriodStart ?? data.current_period_start);
  let currentPeriodEnd = toMs(data.currentPeriodEnd ?? data.current_period_end);
  if (
    currentPeriodStart === undefined ||
    currentPeriodEnd === undefined ||
    currentPeriodStart >= currentPeriodEnd
  ) {
    // An incomplete or inverted period never grants paid access downstream.
    currentPeriodStart = undefined;
    currentPeriodEnd = undefined;
  }

  return {
    eventId: safeEventId,
    organizationId,
    polarSubscriptionId: subscriptionId,
    polarCustomerId: customerId,
    polarProductId: productId,
    polarPriceId: cleanId(isRecord(price) ? price.id : undefined),
    plan: productId ? planForProductId(productId) : undefined,
    status,
    interval: cleanId(data.recurringInterval ?? data.recurring_interval, 32),
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    modifiedAt,
  };
};