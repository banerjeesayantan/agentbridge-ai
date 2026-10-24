/**
 * Standard Webhooks (https://www.standardwebhooks.com) signature check, the
 * scheme Polar signs with. HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`,
 * base64, sent as space-separated `v1,<sig>` entries.
 *
 * Polar's SDK base64-encodes the dashboard secret before handing it to the
 * Standard Webhooks library, which decodes it again, so the HMAC key is the
 * secret's raw UTF-8 bytes. Uses Web Crypto (available in the Convex runtime);
 * `subtle.verify` compares in constant time.
 */
export interface WebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

const b64ToBytes = (b64: string) => {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
};

export async function verifyStandardWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  nowMs: number = Date.now(),
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;

  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${headers.id}.${headers.timestamp}.${rawBody}`);

  for (const entry of headers.signature.split(" ")) {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) continue;
    const sigBytes = b64ToBytes(sig);
    if (sigBytes && (await crypto.subtle.verify("HMAC", key, sigBytes, signed))) return true;
  }
  return false;
}
