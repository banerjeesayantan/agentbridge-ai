/**
 * Central input bounds and rate-limit policy. Every public or staff function
 * that accepts free-form input must use these constants, so limits are
 * reviewed in one place.
 */
import { ConvexError } from "convex/values";

export const INPUT = {
  PROMPT_MAX: 4_000,
  NAME_MAX: 100,
  EMAIL_MAX: 254,
  META_FIELD_MAX: 512,
  ORG_ID_MAX: 128,
  COMMENT_MAX: 2_000,
  FILENAME_MAX: 180,
  SECRET_FIELD_MAX: 256,
  FILE_MAX_BYTES: 10 * 1024 * 1024,
} as const;

export type RateConfig = { capacity: number; refillPerSecond: number };

/** Token-bucket policies. `capacity` is the burst, `refillPerSecond` the sustained rate. */
export const RATE = {
  /** New visitor sessions per organization (~60/min sustained). */
  sessionCreateOrg: { capacity: 60, refillPerSecond: 1 },
  /** New conversations per visitor session. */
  conversationCreateSession: { capacity: 5, refillPerSecond: 1 / 20 },
  /** Visitor messages per session (~12/min sustained). */
  messageSession: { capacity: 8, refillPerSecond: 0.2 },
  /** Visitor messages per organization across all sessions. */
  messageOrg: { capacity: 120, refillPerSecond: 2 },
  /** Voice authorizations per visitor session (3 per 10 minutes). */
  voiceSession: { capacity: 3, refillPerSecond: 3 / 600 },
  /** Verified Clerk organization lookups across the whole deployment. */
  clerkLookupGlobal: { capacity: 30, refillPerSecond: 0.5 },
  /** Call-started reports per session. */
  voiceReportSession: { capacity: 10, refillPerSecond: 0.1 },
} satisfies Record<string, RateConfig>;

const ORG_ID_PATTERN = /^org_[A-Za-z0-9]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function badRequest(message: string, field?: string): never {
  throw new ConvexError({ code: "BAD_REQUEST", message, ...(field ? { field } : {}) });
}

/** Throws BAD_REQUEST when `value` is empty (after trim) or longer than `max`. */
export function assertText(value: string, max: number, field: string, opts: { allowEmpty?: boolean } = {}): string {
  const trimmed = value.trim();
  if (!opts.allowEmpty && trimmed.length === 0) badRequest(`${field} is required`, field);
  if (value.length > max) badRequest(`${field} must be at most ${max} characters`, field);
  return trimmed;
}

export function assertOptionalText(value: string | undefined, max: number, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > max) badRequest(`${field} must be at most ${max} characters`, field);
  return value;
}

export function assertOrgId(value: string): string {
  if (value.length > INPUT.ORG_ID_MAX || !ORG_ID_PATTERN.test(value)) badRequest("Invalid organization ID", "organizationId");
  return value;
}

export function assertEmail(value: string): string {
  const email = assertText(value, INPUT.EMAIL_MAX, "email");
  if (!EMAIL_PATTERN.test(email)) badRequest("Invalid email address", "email");
  return email;
}
