/**
 * Central AgentBridge Vapi credentials, loaded server-side from AWS Secrets
 * Manager through the existing secrets helper. Expected secret JSON:
 *   { "privateApiKey": "...", "orgId": "<vapi organization id>" }
 * The secret name defaults to "platform/vapi" (override: VAPI_CENTRAL_SECRET_NAME).
 * Alternatively set VAPI_CENTRAL_PRIVATE_KEY and VAPI_CENTRAL_ORG_ID as Convex
 * environment variables (encrypted at rest by Convex); they take precedence and
 * remove the AWS dependency for the central voice model.
 * The private key is never logged or returned to a client.
 */
import { getSecretValue, parseSecretString } from "../../../lib/secrets";

export interface CentralVapiCredentials {
  privateApiKey: string;
  orgId: string;
}

const CACHE_MS = 5 * 60 * 1000;
let cache: { value: CentralVapiCredentials; at: number } | null = null;

export function clearCentralVapiCache() {
  cache = null;
}

export async function loadCentralVapiCredentials(now: number = Date.now()): Promise<CentralVapiCredentials | null> {
  const envKey = process.env.VAPI_CENTRAL_PRIVATE_KEY?.trim();
  const envOrg = process.env.VAPI_CENTRAL_ORG_ID?.trim();
  if (envKey && envOrg) return { privateApiKey: envKey, orgId: envOrg };
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  const name = process.env.VAPI_CENTRAL_SECRET_NAME?.trim() || "platform/vapi";
  try {
    const parsed = parseSecretString<{ privateApiKey?: unknown; orgId?: unknown }>(await getSecretValue(name));
    if (
      !parsed ||
      typeof parsed.privateApiKey !== "string" ||
      parsed.privateApiKey.length === 0 ||
      typeof parsed.orgId !== "string" ||
      parsed.orgId.length === 0
    ) {
      return null;
    }
    cache = { value: { privateApiKey: parsed.privateApiKey, orgId: parsed.orgId }, at: now };
    return cache.value;
  } catch {
    return null; // never include the error: it could carry request details
  }
}
