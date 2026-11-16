/**
 * Signs the short-lived, restricted PUBLIC token the browser uses to start one
 * Vapi web call. The private key never leaves the server.
 *
 * What Vapi documents: a public-scope JWT signed with the organization's
 * private key, carrying `orgId` and `token.restrictions` (allowedOrigins,
 * allowedAssistantIds, allowTransientAssistant).
 *
 * What Vapi does NOT document (so nothing here relies on it):
 *  - the signing algorithm: HS256 is assumed (the common default). It MUST be
 *    confirmed against a real Vapi sandbox before production use;
 *  - single use: a token is treated as REUSABLE until it expires;
 *  - whether assistant overrides sent by the browser are blocked.
 */

export interface VapiPublicTokenInput {
  /** Vapi organization ID of the central AgentBridge account. */
  orgId: string;
  /** Central Vapi PRIVATE key (server-side secret). */
  privateKey: string;
  /** The single managed assistant this token may start. */
  assistantId: string;
  allowedOrigins: string[];
  /** Epoch ms. */
  now: number;
  /**
   * Absolute expiry, epoch ms, in whole seconds. The caller fixes it when the
   * reservation is created, so re-issuing a token for the same reservation can
   * never extend the window in which a call may start.
   */
  expiresAt: number;
}

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const jsonPart = (value: unknown) => base64Url(encoder.encode(JSON.stringify(value)));

export async function signVapiPublicToken(
  input: VapiPublicTokenInput,
): Promise<{ token: string; expiresAt: number }> {
  if (!input.orgId || !input.privateKey || !input.assistantId) throw new Error("Vapi token inputs are incomplete");
  if (input.allowedOrigins.length === 0) throw new Error("At least one allowed origin is required");
  const iat = Math.floor(input.now / 1000);
  if (!Number.isInteger(input.expiresAt) || input.expiresAt % 1000 !== 0) throw new Error("Invalid token expiry");
  const exp = input.expiresAt / 1000;
  if (exp <= iat) throw new Error("Token already expired");

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    orgId: input.orgId,
    token: {
      tag: "public",
      restrictions: {
        enabled: true,
        allowedOrigins: input.allowedOrigins,
        allowedAssistantIds: [input.assistantId],
        allowTransientAssistant: false,
      },
    },
    iat,
    exp,
  };

  const signingInput = `${jsonPart(header)}.${jsonPart(payload)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.privateKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput)));
  return { token: `${signingInput}.${base64Url(signature)}`, expiresAt: exp * 1000 };
}
