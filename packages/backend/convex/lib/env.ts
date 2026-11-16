/** Read required configuration with a clear, non-leaking error. */
import { ConvexError } from "convex/values";

export function envOrNull(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export function requireEnv(name: string): string {
  const v = envOrNull(name);
  if (!v) {
    console.error(`CONFIG: missing environment variable ${name}`);
    throw new ConvexError({ code: "CONFIG_MISSING", message: "This feature is not configured." });
  }
  return v;
}
