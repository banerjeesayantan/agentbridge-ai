import { ConvexError } from "convex/values";

const LOCAL_ORIGINS = new Set(["http://localhost", "http://127.0.0.1"]);

export function normalizeAllowedOrigins(values: string[]): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 25) {
    throw new ConvexError({ code: "BAD_REQUEST", message: "Add between 1 and 25 allowed widget origins." });
  }
  const normalized = values.map((raw) => {
    if (typeof raw !== "string" || raw.length > 255) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Invalid widget origin." });
    }
    let url: URL;
    try { url = new URL(raw.trim()); } catch {
      throw new ConvexError({ code: "BAD_REQUEST", message: `Invalid origin: ${raw}` });
    }
    const local = LOCAL_ORIGINS.has(`http://${url.hostname}`) && url.protocol === "http:" && ["", "3000", "3001", "3002", "5173"].includes(url.port);
    if (url.protocol !== "https:" && !local) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Widget origins must use HTTPS (HTTP is allowed only for localhost development)." });
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.origin === "null") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Enter an origin only, such as https://example.com." });
    }
    return url.origin;
  });
  return [...new Set(normalized)];
}

const encoder = new TextEncoder();
function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function signingKey(): Promise<CryptoKey> {
  const secret = process.env.WIDGET_INSTALLATION_SECRET;
  if (!secret || secret.length < 32) throw new Error("WIDGET_INSTALLATION_SECRET must contain at least 32 characters.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export interface WidgetInstallClaims {
  organizationId: string;
  origin: string;
  issuedAt: number;
  expiresAt: number;
}

export async function signWidgetInstallToken(claims: WidgetInstallClaims): Promise<string> {
  const payload = encode(encoder.encode(JSON.stringify(claims)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(payload)));
  return `${payload}.${encode(signature)}`;
}

export async function verifyWidgetInstallToken(token: string, expectedOrganizationId: string, expectedOrigin?: string): Promise<WidgetInstallClaims> {
  try {
    if (typeof token !== "string" || token.length > 4096) throw new Error("Invalid token");
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw new Error("Malformed token");
    const valid = await crypto.subtle.verify("HMAC", await signingKey(), decode(signature), encoder.encode(payload));
    if (!valid) throw new Error("Invalid signature");
    const claims = JSON.parse(new TextDecoder().decode(decode(payload))) as WidgetInstallClaims;
    const now = Date.now();
    if (claims.organizationId !== expectedOrganizationId || !Number.isFinite(claims.issuedAt) || !Number.isFinite(claims.expiresAt) || claims.issuedAt > now + 30_000 || claims.expiresAt <= now || claims.expiresAt - claims.issuedAt > 10 * 60_000) throw new Error("Expired or invalid claims");
    if (expectedOrigin && claims.origin !== expectedOrigin) throw new Error("Origin mismatch");
    return claims;
  } catch {
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Widget installation is not authorized. Reload the page and try again." });
  }
}
