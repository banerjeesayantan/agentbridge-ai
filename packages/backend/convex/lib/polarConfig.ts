/**
 * Polar configuration, read from Convex environment variables only.
 * Nothing here is a secret default and no product ID is invented: an
 * unset variable means that plan is simply not purchasable yet.
 *
 *   POLAR_ACCESS_TOKEN        organization access token (server-side only)
 *   POLAR_SERVER              "sandbox" | "production" (default "sandbox")
 *   POLAR_WEBHOOK_SECRET      webhook signing secret from Polar
 *   POLAR_PRODUCT_PRO_ID      Polar product ID for the Pro plan
 *   POLAR_PRODUCT_enterprise_ID Polar product ID for the enterprise plan
 *   APP_URL                   public dashboard URL for checkout redirects
 */

/**
 * Polar configuration, read from Convex environment variables only.
 *
 * POLAR_ACCESS_TOKEN          Server-side Polar access token
 * POLAR_SERVER                "sandbox" | "production"
 * POLAR_WEBHOOK_SECRET        Polar webhook signing secret
 * POLAR_PRODUCT_PRO_ID        Polar Pro product ID
 * POLAR_PRODUCT_ENTERPRISE_ID Polar Enterprise product ID
 * APP_URL                     Public dashboard URL
 */

import type { PaidPlanKey } from "./entitlements";

export function polarServer(): "sandbox" | "production" {
  return process.env.POLAR_SERVER === "production"
    ? "production"
    : "sandbox";
}

export function productIdForPlan(
  plan: PaidPlanKey,
): string | undefined {
  let id: string | undefined;

  switch (plan) {
    case "pro":
      id = process.env.POLAR_PRODUCT_PRO_ID;
      break;
    case "enterprise":
      id = process.env.POLAR_PRODUCT_ENTERPRISE_ID;
      break;
    default:
      return undefined;
  }

  return id?.trim() || undefined;
}

/** Unknown Polar products never grant paid access. */
export function planForProductId(
  productId: string | undefined,
): PaidPlanKey | undefined {
  if (!productId) return undefined;

  if (productId === productIdForPlan("pro")) return "pro";
  if (productId === productIdForPlan("enterprise")) return "enterprise";

  return undefined;
}

export function billingConfigured(): boolean {
  return Boolean(
    process.env.POLAR_ACCESS_TOKEN &&
      productIdForPlan("pro") &&
      productIdForPlan("enterprise"),
  );
}
