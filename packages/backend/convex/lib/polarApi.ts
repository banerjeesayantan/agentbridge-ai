/**
 * Minimal Polar REST client (https://docs.polar.sh/api-reference). Uses the
 * documented HTTP API directly so billing does not depend on a particular
 * SDK release. The access token stays server-side and is never logged.
 */
import { polarServer } from "./polarConfig";

export class PolarApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`Polar API error ${status}`);
  }
}

export const polarBaseUrl = () =>
  polarServer() === "production" ? "https://api.polar.sh" : "https://sandbox-api.polar.sh";

export async function polarRequest<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const token = process.env.POLAR_ACCESS_TOKEN;
  if (!token) throw new Error("POLAR_ACCESS_TOKEN is not configured");

  const res = await fetchImpl(`${polarBaseUrl()}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) throw new PolarApiError(res.status, (await res.text()).slice(0, 500));
  return (await res.json()) as T;
}

export interface CheckoutParams {
  productId: string;
  organizationId: string;
  email?: string;
  successUrl: string;
  returnUrl: string;
}

export const checkoutBody = (p: CheckoutParams) => ({
  products: [p.productId],
  // Ties the Polar customer to our organization; echoed back as
  // customer.external_id in every subscription webhook.
  external_customer_id: p.organizationId,
  ...(p.email ? { customer_email: p.email } : {}),
  metadata: { organizationId: p.organizationId },
  success_url: p.successUrl,
  return_url: p.returnUrl,
});
