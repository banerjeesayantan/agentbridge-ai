import { ConvexError } from "convex/values";

type ErrorData = { code?: string; message?: string; retryAfterMs?: number };

function parse(error: unknown): ErrorData | null {
  if (error instanceof ConvexError) {
    const data = error.data as unknown;
    if (typeof data === "string") {
      try {
        return JSON.parse(data) as ErrorData;
      } catch {
        return { message: data };
      }
    }
    return (data ?? null) as ErrorData | null;
  }
  return null;
}

/** Machine-readable backend error code, if the error came from our API. */
export const errorCode = (error: unknown): string | undefined => parse(error)?.code;

/** A message safe to show to a visitor (never raw provider or stack text). */
export function visitorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const data = parse(error);
  if (!data) return fallback;
  if (data.code === "RATE_LIMITED") return "You're sending requests too quickly. Please wait a moment and try again.";
  return data.message && data.code !== "INTERNAL" ? data.message : fallback;
}
