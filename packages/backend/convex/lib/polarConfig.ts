/**
 * Polar configuration, read from Convex environment variables only.
 * Nothing here is a secret default and no product ID is invented: an
 * unset variable means that plan is simply not purchasable yet.
 *
 *   POLAR_ACCESS_TOKEN        organization access token (server-side only)
 *   POLAR_SERVER              "sandbox" | "production" (default "sandbox")
 *   POLAR_WEBHOOK_SECRET      webhook signing secret from Polar
 *   POLAR_PRODUCT_PRO_ID      Polar product ID for the Pro plan
 *   POLAR_PRODUCT_BUSINESS_ID Polar product ID for the Business plan
 *   APP_URL                   public dashboard URL for checkout redirects
 */
import type { PaidPlanKey } from "./entitlements";

export function polarServer(): "sandbox" | "production" {
  return process.env.POLAR_SERVER === "production" ? "production" : "sandbox";
}

export function productIdForPlan(plan: PaidPlanKey): string | undefined {
  const id = plan === "pro" ? process.env.POLAR_PRODUCT_PRO_ID : process.env.POLAR_PRODUCT_BUSINESS_ID;
  return id && id.trim() ? id.trim() : undefined;
}

/** Reverse lookup used by the webhook: unknown products never map to a paid plan. */
export function planForProductId(productId: string | undefined): PaidPlanKey | undefined {
  if (!productId) return undefined;
  if (productId === productIdForPlan("pro")) return "pro";
  if (productId === productIdForPlan("business")) return "business";
  return undefined;
}

export function billingConfigured(): boolean {
  return Boolean(process.env.POLAR_ACCESS_TOKEN && (productIdForPlan("pro") || productIdForPlan("business")));
}
