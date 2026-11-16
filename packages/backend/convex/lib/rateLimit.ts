/**
 * Token-bucket rate limiting stored in Convex (no external service).
 * Mutations are serialized per document, so concurrent callers cannot both
 * spend the same token. A denial WRITES NOTHING and RETURNS (it never throws
 * after writing, which would roll the write back).
 */
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { RateConfig } from "./limits";

export interface BucketState {
  tokens: number;
  updatedAt: number;
}

/** Pure: refill, then try to spend `cost`. */
export function evaluateBucket(
  state: BucketState | null,
  cfg: RateConfig,
  now: number,
  cost = 1,
): { ok: true; next: BucketState } | { ok: false; retryAfterMs: number } {
  const elapsedSec = state ? Math.max(0, (now - state.updatedAt) / 1000) : 0;
  const available = state ? Math.min(cfg.capacity, state.tokens + elapsedSec * cfg.refillPerSecond) : cfg.capacity;
  if (available >= cost) return { ok: true, next: { tokens: available - cost, updatedAt: now } };
  const missing = cost - available;
  return { ok: false, retryAfterMs: Math.ceil((missing / cfg.refillPerSecond) * 1000) };
}

export async function takeTokens(
  ctx: Pick<MutationCtx, "db">,
  key: string,
  cfg: RateConfig,
  cost = 1,
  now: number = Date.now(),
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const row = await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", key)).first();
  const result = evaluateBucket(row ? { tokens: row.tokens, updatedAt: row.updatedAt } : null, cfg, now, cost);
  if (!result.ok) return result;
  if (row) await ctx.db.patch(row._id, result.next);
  else await ctx.db.insert("rateLimits", { key, ...result.next });
  return { ok: true };
}

export function rateLimited(retryAfterMs: number): never {
  throw new ConvexError({
    code: "RATE_LIMITED",
    message: "Too many requests. Please slow down and try again shortly.",
    retryAfterMs,
  });
}

/** For mutations: spend a token or throw RATE_LIMITED (nothing was written on denial). */
export async function enforceRateLimit(ctx: Pick<MutationCtx, "db">, key: string, cfg: RateConfig, cost = 1): Promise<void> {
  const r = await takeTokens(ctx, key, cfg, cost);
  if (!r.ok) rateLimited(r.retryAfterMs);
}
