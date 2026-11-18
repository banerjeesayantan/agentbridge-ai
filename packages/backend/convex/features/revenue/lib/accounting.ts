/**
 * Per-organization voice accounting. Pure: takes already-filtered rows.
 *
 * Definitions (kept separate on purpose):
 *  - netCollected   = payments - refunds - reported platform fees   (cash view)
 *  - vapiExpense    = SUM of KNOWN actual provider costs            (what we paid Vapi)
 *  - contribution   = netCollected - vapiExpense                    (before infrastructure costs)
 *  - allocation     = netCollected split by basis points            (a plan for the money, NOT earnings)
 *  - reserved funds are a wallet concept and appear nowhere in these numbers.
 *
 * Costs still pending are counted, not valued: `provisional` is true while any
 * exist, so contribution is never presented as final with an unknown cost.
 */
import { DEFAULT_ALLOCATION, splitByBasisPoints, type AllocationPart } from "../../../lib/money";

export interface RevenueEntryLite {
  kind: "payment" | "refund" | "platform_fee";
  amountMicro: number;
}

export interface UsageLite {
  costStatus: "known" | "pending";
  costMicro?: number;
  customerChargeMicro?: number;
}

export interface OrgAccounting {
  grossPaymentsMicro: number;
  refundsMicro: number;
  platformFeesMicro: number;
  /** Whether Polar reported a platform fee for at least one order in the window. */
  platformFeesReported: boolean;
  /** Signed: a refund can exceed collections in a window. */
  netCollectedMicro: number;
  callCount: number;
  pendingCostCalls: number;
  vapiExpenseKnownMicro: number;
  customerChargesMicro: number;
  /** Signed. Before infrastructure costs, which are not tracked here. */
  contributionMicro: number;
  provisional: boolean;
  allocation: Record<string, number>;
}

export function computeOrgAccounting(input: {
  entries: readonly RevenueEntryLite[];
  usage: readonly UsageLite[];
  allocation?: readonly AllocationPart[];
}): OrgAccounting {
  let payments = 0;
  let refunds = 0;
  let fees = 0;
  let feesReported = false;
  for (const e of input.entries) {
    if (e.kind === "payment") payments += e.amountMicro;
    else if (e.kind === "refund") refunds += e.amountMicro;
    else {
      fees += e.amountMicro;
      feesReported = true;
    }
  }

  let expense = 0;
  let charges = 0;
  let pending = 0;
  for (const u of input.usage) {
    if (u.costStatus === "known" && typeof u.costMicro === "number") {
      expense += u.costMicro;
      charges += u.customerChargeMicro ?? 0;
    } else pending++;
  }

  const net = payments - refunds - fees;
  return {
    grossPaymentsMicro: payments,
    refundsMicro: refunds,
    platformFeesMicro: fees,
    platformFeesReported: feesReported,
    netCollectedMicro: net,
    callCount: input.usage.length,
    pendingCostCalls: pending,
    vapiExpenseKnownMicro: expense,
    customerChargesMicro: charges,
    contributionMicro: net - expense,
    provisional: pending > 0,
    // Nothing is allocated from a non-positive net: refunds never create negative allocations.
    allocation: splitByBasisPoints(Math.max(0, net), input.allocation ?? DEFAULT_ALLOCATION),
  };
}
