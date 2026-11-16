/**
 * Money helpers. Every stored amount is an INTEGER number of micro-dollars
 * (1 USD = 1_000_000). Floats never touch a ledger: provider costs arrive as
 * USD floats and are converted once, at the edge, with `usdToMicro`.
 */

export const MICRO_PER_USD = 1_000_000;

/** A valid stored amount: a non-negative safe integer. */
export function isMicro(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function assertMicro(value: unknown, label: string): number {
  if (!isMicro(value)) throw new RangeError(`${label} must be a non-negative integer micro-dollar amount`);
  return value;
}

/**
 * Convert a provider-reported USD amount to micro-dollars (rounded to the
 * nearest micro-dollar). Returns null for anything that is not a real,
 * finite, non-negative number, so an unknown cost can never become zero.
 */
export function usdToMicro(usd: unknown): number | null {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) return null;
  const micro = Math.round(usd * MICRO_PER_USD);
  return Number.isSafeInteger(micro) ? micro : null;
}

/** Display only (never parse this back): "$14.75", "$0.012346". */
export function formatUsd(micro: number): string {
  if (!isMicro(micro)) return "$0.00";
  const fixed = (micro / MICRO_PER_USD).toFixed(6);
  const trimmed = fixed.replace(/0+$/, "");
  const [whole, frac = ""] = trimmed.split(".");
  return `$${whole}.${frac.padEnd(2, "0")}`;
}

export interface AllocationPart {
  key: string;
  /** Basis points: 10_000 = 100%. */
  bps: number;
}

export const DEFAULT_ALLOCATION: readonly AllocationPart[] = [
  { key: "vapiReserve", bps: 2_500 },
  { key: "infrastructureReserve", bps: 1_500 },
  { key: "operating", bps: 6_000 },
];

/** Validates a basis-point allocation: integers, no negatives, totals exactly 10_000. */
export function validateAllocation(parts: readonly AllocationPart[]): boolean {
  if (parts.length === 0) return false;
  const keys = new Set(parts.map((p) => p.key));
  if (keys.size !== parts.length) return false;
  let total = 0;
  for (const p of parts) {
    if (!Number.isInteger(p.bps) || p.bps < 0 || p.key.length === 0) return false;
    total += p.bps;
  }
  return total === 10_000;
}

/**
 * Split an amount by basis points using exact integer (BigInt) math. Each
 * part is rounded DOWN and the rounding remainder is assigned to
 * `remainderKey`, so the parts always sum exactly to `amount`.
 */
export function splitByBasisPoints(
  amount: number,
  parts: readonly AllocationPart[] = DEFAULT_ALLOCATION,
  remainderKey = "operating",
): Record<string, number> {
  assertMicro(amount, "amount");
  if (!validateAllocation(parts)) throw new RangeError("allocation must be integer basis points totalling 10000");
  if (!parts.some((p) => p.key === remainderKey)) throw new RangeError("remainderKey must name an allocation part");

  const out: Record<string, number> = {};
  let assigned = 0;
  for (const p of parts) {
    const share = Number((BigInt(amount) * BigInt(p.bps)) / 10_000n);
    out[p.key] = share;
    assigned += share;
  }
  out[remainderKey] = (out[remainderKey] ?? 0) + (amount - assigned);
  return out;
}
