/**
 * Routes a VERIFIED Polar order.paid / order.refunded event to revenue
 * accounting. Called from system/polarWebhook.ts after signature verification.
 * Returns the HTTP status the webhook should answer with:
 *  - 200 for events we handled, deliberately ignore, or cannot ever process;
 *  - 500 only for a genuine transient failure, so Polar retries.
 * A malformed event for one of OUR organizations is logged at ERROR level
 * (it may be a real customer payment that needs manual attention) but is not
 * retried, because the same payload would fail identically.
 */
import { parsePolarOrderEvent } from "./polarOrder";

interface MutationRunner {
  runMutation: (ref: any, args: any) => Promise<any>;
}

export async function handlePolarOrderEvent(
  ctx: MutationRunner,
  applyOrderEvent: unknown,
  type: string,
  data: unknown,
  webhookId: string,
  now: number,
): Promise<{ status: number }> {
  const parsed = parsePolarOrderEvent(type, data, now);
  if (parsed.kind === "ignore" || parsed.kind === "unlinked") return { status: 200 };

  if (parsed.kind === "invalid") {
    console.error("ALERT: Polar order event for a linked customer could not be accounted for", {
      type,
      webhookId,
      reason: parsed.reason,
    });
    return { status: 200 };
  }

  try {
    const { polarOrderId, organizationId, type: orderType, netMicro, refundedTotalMicro, feeMicro, occurredAt } = parsed.order;
    const result = await ctx.runMutation(applyOrderEvent, {
      polarOrderId,
      organizationId,
      type: orderType,
      netMicro,
      refundedTotalMicro,
      feeMicro,
      occurredAt,
    });
    if (!result.ok) {
      console.error("ALERT: Polar order event rejected by revenue accounting", { type, webhookId, code: result.code });
    }
    return { status: 200 };
  } catch (error) {
    console.error("Failed to record Polar order revenue; requesting retry", { type, webhookId });
    return { status: 500 };
  }
}
