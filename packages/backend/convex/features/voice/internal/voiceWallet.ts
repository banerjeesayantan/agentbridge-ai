import { v } from "convex/values";
import type { Doc, Id } from "../../../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../../../_generated/server";
import { getEntitlements } from "../../../lib/entitlements";
import { isMicro } from "../../../lib/money";
import { holdDeadline, readVoiceBudgetConfig } from "../lib/voiceBudget";

export type DenyCode =
  | "VOICE_UNAVAILABLE"
  | "SESSION_INVALID"
  | "PROVIDER_PAUSED"
  | "ORG_SUSPENDED"
  | "PLAN_REQUIRED"
  | "NO_ASSISTANT"
  | "IN_PROGRESS"
  | "SESSION_LIMIT"
  | "NO_BUDGET";

type TxType = "grant" | "reserve" | "release" | "settle";

type ReservationStatus = "settled" | "expired_no_report" | "released_unissued";

/**
 * Append one ledger transaction and update its wallet aggregate.
 * Repeated idempotency keys never apply a second balance change.
 */
async function applyTx(
  ctx: MutationCtx,
  tx: {
    walletId: Id<"voiceWallets">;
    organizationId: string;
    type: TxType;
    amountMicro: number;
    key: string;
    reservationId?: Id<"voiceCallReservations">;
    providerCallId?: string;
    note?: string;
  },
): Promise<boolean> {
  if (!isMicro(tx.amountMicro)) {
    throw new RangeError(
      "Ledger amounts must be non-negative integer micro-dollars",
    );
  }

  const existing = await ctx.db
    .query("voiceWalletTransactions")
    .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", tx.key))
    .first();

  if (existing) return false;

  const wallet = await ctx.db.get(tx.walletId);
  if (!wallet) throw new Error("Wallet not found");

  let budgetMicro = wallet.budgetMicro;
  let reservedMicro = wallet.reservedMicro;
  let spentMicro = wallet.spentMicro;

  switch (tx.type) {
    case "grant":
      budgetMicro += tx.amountMicro;
      break;

    case "reserve":
      reservedMicro += tx.amountMicro;
      break;

    case "release": {
      const releasedMicro = Math.min(tx.amountMicro, reservedMicro);

      if (releasedMicro !== tx.amountMicro) {
        console.error("ALERT: wallet release exceeded reserved balance", {
          walletId: tx.walletId,
          requestedMicro: tx.amountMicro,
          availableReservedMicro: reservedMicro,
        });
      }

      reservedMicro -= releasedMicro;
      break;
    }

    case "settle":
      spentMicro += tx.amountMicro;
      break;
  }

  const now = Date.now();

  await ctx.db.patch(tx.walletId, {
    budgetMicro,
    reservedMicro,
    spentMicro,
    updatedAt: now,
  });

  await ctx.db.insert("voiceWalletTransactions", {
    walletId: tx.walletId,
    organizationId: tx.organizationId,
    type: tx.type,
    amountMicro: tx.amountMicro,
    idempotencyKey: tx.key,
    reservationId: tx.reservationId,
    providerCallId: tx.providerCallId,
    note: tx.note,
    createdAt: now,
  });

  return true;
}

/**
 * Persist idempotent alerts when actual provider cost exceeds its reservation
 * or pushes the organization's wallet spend beyond its budget.
 */
async function recordProviderCostAlerts(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    providerCallId: string;
    reservation: Doc<"voiceCallReservations">;
    wallet: Doc<"voiceWallets">;
    actualCostMicro: number;
    resultingSpentMicro: number;
  },
) {
  const alertTypes: Array<"RESERVATION_OVERRUN" | "BUDGET_EXCEEDED"> = [];

  if (args.actualCostMicro > args.reservation.reservedMicro) {
    alertTypes.push("RESERVATION_OVERRUN");
  }

  if (args.resultingSpentMicro > args.wallet.budgetMicro) {
    alertTypes.push("BUDGET_EXCEEDED");
  }

  for (const alertType of alertTypes) {
    const idempotencyKey =
      `vapi:cost-overrun:${args.providerCallId}:${alertType}`;

    const existing = await ctx.db
      .query("voiceCostAlerts")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .first();

    if (existing) continue;

    await ctx.db.insert("voiceCostAlerts", {
      organizationId: args.organizationId,
      providerCallId: args.providerCallId,
      reservationId: args.reservation._id,
      alertType,
      reservedMicro: args.reservation.reservedMicro,
      actualCostMicro: args.actualCostMicro,
      budgetMicro: args.wallet.budgetMicro,
      resultingSpentMicro: args.resultingSpentMicro,
      idempotencyKey,
      createdAt: Date.now(),
    });

    console.error("ALERT: Vapi provider cost overrun", {
      organizationId: args.organizationId,
      providerCallId: args.providerCallId,
      alertType,
      reservedMicro: args.reservation.reservedMicro,
      actualCostMicro: args.actualCostMicro,
      budgetMicro: args.wallet.budgetMicro,
      resultingSpentMicro: args.resultingSpentMicro,
    });
  }
}

/**
 * Release a reservation hold and close its lifecycle.
 */
async function closeHold(
  ctx: MutationCtx,
  reservation: Doc<"voiceCallReservations">,
  status: ReservationStatus,
  suffix: string,
  extra: {
    providerCallId?: string;
    note?: string;
  } = {},
) {
  await applyTx(ctx, {
    walletId: reservation.walletId,
    organizationId: reservation.organizationId,
    type: "release",
    amountMicro: reservation.reservedMicro,
    key: `release:${reservation._id}:${suffix}`,
    reservationId: reservation._id,
    providerCallId: extra.providerCallId,
    note: extra.note,
  });

  await ctx.db.patch(reservation._id, {
    status,
    settledAt: Date.now(),
    ...(extra.providerCallId ? { providerCallId: extra.providerCallId } : {}),
  });
}

/**
 * Get or create the organization's wallet for the current billing period.
 *
 * Upgrades top up the budget by the difference.
 * Downgrades do not claw back already granted budget.
 */
async function ensureWallet(
  ctx: MutationCtx,
  organizationId: string,
  periodStart: number,
  periodEnd: number,
  planBudgetMicro: number,
  now: number,
): Promise<Doc<"voiceWallets">> {
  let wallet = await ctx.db
    .query("voiceWallets")
    .withIndex("by_organization_id_and_period_start", (q) =>
      q.eq("organizationId", organizationId).eq("periodStart", periodStart),
    )
    .unique();

  if (!wallet) {
    const walletId = await ctx.db.insert("voiceWallets", {
      organizationId,
      periodStart,
      periodEnd,
      budgetMicro: 0,
      reservedMicro: 0,
      spentMicro: 0,
      createdAt: now,
      updatedAt: now,
    });

    await applyTx(ctx, {
      walletId,
      organizationId,
      type: "grant",
      amountMicro: planBudgetMicro,
      key: `grant:${organizationId}:${periodStart}:${planBudgetMicro}`,
    });

    const createdWallet = await ctx.db.get(walletId);
    if (!createdWallet) throw new Error("Wallet creation failed");

    return createdWallet;
  }

  if (planBudgetMicro > wallet.budgetMicro) {
    await applyTx(ctx, {
      walletId: wallet._id,
      organizationId,
      type: "grant",
      amountMicro: planBudgetMicro - wallet.budgetMicro,
      key: `grant:${organizationId}:${periodStart}:${planBudgetMicro}`,
      note: "plan budget increase",
    });

    const updatedWallet = await ctx.db.get(wallet._id);
    if (!updatedWallet) throw new Error("Wallet not found after grant");

    wallet = updatedWallet;
  }

  return wallet;
}

/**
 * Release authorized holds whose deadline has passed.
 */
async function expireOrgHolds(
  ctx: MutationCtx,
  organizationId: string,
  now: number,
) {
  const openReservations = await ctx.db
    .query("voiceCallReservations")
    .withIndex("by_organization_id_and_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", "authorized"),
    )
    .take(50);

  for (const reservation of openReservations) {
    if (reservation.holdDeadline <= now) {
      await closeHold(ctx, reservation, "expired_no_report", "expired", {
        note: "no provider event by hold deadline",
      });
    }
  }
}

/**
 * Authorize one paid voice call.
 *
 * The browser supplies only its contact session ID.
 * Organization, plan, assistant and budget are resolved server-side.
 */
export const reserveCall = internalMutation({
  args: {
    contactSessionId: v.id("contactSessions"),
  },

  handler: async (ctx, args) => {
    const now = Date.now();
    const deny = (code: DenyCode) => ({
      ok: false as const,
      code,
    });

    const config = readVoiceBudgetConfig(process.env);

    if (!config.ready) {
      return deny("VOICE_UNAVAILABLE");
    }

    const session = await ctx.db.get(args.contactSessionId);

    if (!session || session.expiresAt <= now) {
      return deny("SESSION_INVALID");
    }

    const organizationId = session.organizationId;

    const providerAccount = await ctx.db
      .query("providerAccount")
      .withIndex("by_key", (q) => q.eq("key", "central"))
      .first();

    if (providerAccount?.paused) {
      return deny("PROVIDER_PAUSED");
    }

    const organizationControl = await ctx.db
      .query("orgVoiceControls")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", organizationId),
      )
      .first();

    if (organizationControl?.suspended) {
      return deny("ORG_SUSPENDED");
    }

    const entitlements = await getEntitlements(ctx, organizationId, now);

    if (
      (entitlements.plan !== "pro" && entitlements.plan !== "enterprise") ||
      !entitlements.limits.voice
    ) {
      return deny("PLAN_REQUIRED");
    }

    const budgetPlan = entitlements.plan === "enterprise" ? "enterprise" : "pro";

    const planBudgetMicro = config.planBudgetMicro[budgetPlan];

    if (!isMicro(planBudgetMicro) || planBudgetMicro === 0) {
      return deny("VOICE_UNAVAILABLE");
    }

    const assistant = await ctx.db
      .query("managedAssistants")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", organizationId),
      )
      .first();

    if (!assistant) {
      return deny("NO_ASSISTANT");
    }

    // Returned denials commit this housekeeping.
    await expireOrgHolds(ctx, organizationId, now);

    const wallet = await ensureWallet(
      ctx,
      organizationId,
      entitlements.periodStart,
      entitlements.periodEnd,
      planBudgetMicro,
      now,
    );

    const openReservations = await ctx.db
      .query("voiceCallReservations")
      .withIndex("by_organization_id_and_status", (q) =>
        q.eq("organizationId", organizationId).eq("status", "authorized"),
      )
      .take(50);

    // Reuse the same visitor's active reservation without extending expiry.
    const existingReservation = openReservations.find(
      (reservation) =>
        reservation.contactSessionId === args.contactSessionId &&
        reservation.tokenExpiresAt > now,
    );

    if (existingReservation) {
      // One reservation authorizes exactly one provider call. Once it is bound
      // to a call, it must never be handed out again.
      if (existingReservation.providerCallId !== undefined) {
        return deny("IN_PROGRESS");
      }

      return {
        ok: true as const,
        reused: true,
        reservationId: existingReservation._id,
        assistantId: existingReservation.assistantId,
        tokenExpiresAt: existingReservation.tokenExpiresAt,
        maxCallSeconds: existingReservation.maxCallSeconds,
        reservedMicro: existingReservation.reservedMicro,
      };
    }

    if (openReservations.length >= config.maxConcurrentPerOrg) {
      return deny("IN_PROGRESS");
    }

    const previousAuthorizations = await ctx.db
      .query("voiceCallReservations")
      .withIndex("by_contact_session_id", (q) =>
        q.eq("contactSessionId", args.contactSessionId),
      )
      .take(config.maxAuthorizationsPerSession);

    if (previousAuthorizations.length >= config.maxAuthorizationsPerSession) {
      return deny("SESSION_LIMIT");
    }

    const availableMicro =
      wallet.budgetMicro - wallet.spentMicro - wallet.reservedMicro;

    if (availableMicro < config.reservationMicro) {
      return deny("NO_BUDGET");
    }

    const tokenExpiresAt =
      (Math.floor(now / 1000) + config.tokenTtlSeconds) * 1000;

    const reservationId = await ctx.db.insert("voiceCallReservations", {
      organizationId,
      contactSessionId: args.contactSessionId,
      walletId: wallet._id,
      assistantId: assistant.vapiAssistantId,
      reservedMicro: config.reservationMicro,
      status: "authorized",
      tokenExpiresAt,
      holdDeadline: holdDeadline(tokenExpiresAt, config),
      maxCallSeconds: config.maxCallSeconds,
      createdAt: now,
    });

    await applyTx(ctx, {
      walletId: wallet._id,
      organizationId,
      type: "reserve",
      amountMicro: config.reservationMicro,
      key: `reserve:${reservationId}`,
      reservationId,
    });

    return {
      ok: true as const,
      reused: false,
      reservationId,
      assistantId: assistant.vapiAssistantId,
      tokenExpiresAt,
      maxCallSeconds: config.maxCallSeconds,
      reservedMicro: config.reservationMicro,
    };
  },
});

/**
 * Release a reservation when token issuance failed.
 * This must only be called when the token was never returned to the browser.
 */
export const releaseUnissued = internalMutation({
  args: {
    reservationId: v.id("voiceCallReservations"),
  },

  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);

    if (!reservation || reservation.status !== "authorized") {
      return { released: false as const };
    }

    await closeHold(ctx, reservation, "released_unissued", "unissued", {
      note: "token not issued",
    });

    return { released: true as const };
  },
});

/**
 * Bind one authorized reservation to exactly one provider call.
 *
 * This mutation does NOT verify that the provider call exists. It must only be
 * invoked by `voiceBinding.bindVerifiedCall`, which confirms the call with the
 * provider and resolves the reservation server-side. Never call it with a
 * browser-supplied ID. Binding is one-to-one and idempotent: the same pair
 * binds once, and neither side can be bound to anything else afterwards.
 */
export const bindCall = internalMutation({
  args: {
    reservationId: v.id("voiceCallReservations"),
    providerCallId: v.string(),
    assistantId: v.string(),
  },

  handler: async (ctx, args) => {
    const now = Date.now();

    const reservation = await ctx.db.get(args.reservationId);

    if (!reservation) {
      return { ok: false as const, code: "UNKNOWN_RESERVATION" as const };
    }

    if (reservation.assistantId !== args.assistantId) {
      return { ok: false as const, code: "ASSISTANT_MISMATCH" as const };
    }

    if (reservation.providerCallId === args.providerCallId) {
      return { ok: true as const, outcome: "already_bound" as const };
    }

    if (reservation.providerCallId !== undefined) {
      return { ok: false as const, code: "RESERVATION_ALREADY_BOUND" as const };
    }

    if (reservation.status !== "authorized" || reservation.holdDeadline <= now) {
      return { ok: false as const, code: "RESERVATION_NOT_OPEN" as const };
    }

    const recordedUsage = await ctx.db
      .query("voiceUsage")
      .withIndex("by_provider_call_id", (q) =>
        q.eq("providerCallId", args.providerCallId),
      )
      .first();

    if (recordedUsage) {
      return { ok: false as const, code: "CALL_ALREADY_RECORDED" as const };
    }

    // The same provider call can never be bound to two reservations.
    const siblings = await ctx.db
      .query("voiceCallReservations")
      .withIndex("by_organization_id_and_status", (q) =>
        q
          .eq("organizationId", reservation.organizationId)
          .eq("status", "authorized"),
      )
      .take(50);

    if (
      siblings.some(
        (item) =>
          item._id !== reservation._id &&
          item.providerCallId === args.providerCallId,
      )
    ) {
      return { ok: false as const, code: "CALL_BOUND_ELSEWHERE" as const };
    }

    await ctx.db.patch(reservation._id, {
      providerCallId: args.providerCallId,
    });

    return { ok: true as const, outcome: "bound" as const };
  },
});

/**
 * Server-side lookup used by `voiceBinding.bindReportedCall`. Succeeds only
 * when the reservation belongs to the caller's visitor session and is open.
 * It never searches for a reservation by time window or assistant: the caller
 * must name the exact reservation it was issued.
 */
export const getReservationForBinding = internalQuery({
  args: {
    reservationId: v.id("voiceCallReservations"),
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation || reservation.contactSessionId !== args.contactSessionId) {
      return { ok: false as const, code: "UNKNOWN_RESERVATION" as const };
    }
    if (reservation.providerCallId !== undefined) {
      return {
        ok: true as const,
        alreadyBoundTo: reservation.providerCallId,
        assistantId: reservation.assistantId,
        createdAt: reservation.createdAt,
        tokenExpiresAt: reservation.tokenExpiresAt,
      };
    }
    if (reservation.status !== "authorized" || reservation.holdDeadline <= Date.now()) {
      return { ok: false as const, code: "RESERVATION_NOT_OPEN" as const };
    }
    return {
      ok: true as const,
      alreadyBoundTo: undefined,
      assistantId: reservation.assistantId,
      createdAt: reservation.createdAt,
      tokenExpiresAt: reservation.tokenExpiresAt,
    };
  },
});

type ProviderReport = {
  providerCallId: string;
  assistantId: string;
  costMicro?: number;
  rawCostUsd?: number;
  durationSeconds?: number;
  startedAtMs?: number;
  endedAtMs?: number;
  endedReason?: string;
  overridesDetected: boolean;
};

const reportFields = {
  providerCallId: v.string(),
  assistantId: v.string(),
  costMicro: v.optional(v.number()),
  rawCostUsd: v.optional(v.number()),
  durationSeconds: v.optional(v.number()),
  startedAtMs: v.optional(v.number()),
  endedAtMs: v.optional(v.number()),
  endedReason: v.optional(v.string()),
  overridesDetected: v.boolean(),
};

/** How long an unbound provider report waits for its binding before it is flagged unmatched. */
export const UNBOUND_REPORT_GRACE_MS = 15 * 60 * 1000;

async function managedOrgFor(ctx: MutationCtx, assistantId: string): Promise<string | null> {
  const mapping = await ctx.db
    .query("managedAssistants")
    .withIndex("by_vapi_assistant_id", (q) => q.eq("vapiAssistantId", assistantId))
    .first();
  return mapping ? mapping.organizationId : null;
}

/**
 * Settle one provider end-of-call report against the reservation that was
 * VERIFIED and bound to this exact provider call ID.
 *
 * Never guesses: if no reservation is bound to the call, the report is parked
 * in `unboundVoiceReports` (the webhook can arrive before the browser reports
 * the call ID) and settled later by `settlePendingReport`, or flagged
 * "unmatched" by `reconcileUnboundReports`. It is never assigned to a wallet
 * by time or assistant heuristics.
 */
async function settleReport(ctx: MutationCtx, eventKey: string, report: ProviderReport) {
  const now = Date.now();

  if (report.costMicro !== undefined && !isMicro(report.costMicro)) {
    return { ok: false as const, code: "INVALID" as const };
  }

  const existingUsage = await ctx.db
    .query("voiceUsage")
    .withIndex("by_provider_call_id", (q) =>
      q.eq("providerCallId", report.providerCallId),
    )
    .first();

  const processed = await ctx.db
    .query("processedProviderEvents")
    .withIndex("by_event_key", (q) => q.eq("eventKey", eventKey))
    .first();

  if (existingUsage) {
    const organizationId = await managedOrgFor(ctx, report.assistantId);

    if (
      existingUsage.assistantId !== report.assistantId ||
      !organizationId ||
      existingUsage.organizationId !== organizationId
    ) {
      console.error("ALERT: late provider report identity mismatch", {
        providerCallId: report.providerCallId,
      });
      return { ok: false as const, code: "RESERVATION_MISMATCH" as const };
    }

    // A report can become an unmatched platform expense while its provider
    // cost is still unknown. If a later provider delivery supplies the cost,
    // reconcile the platform ledger without ever charging a tenant wallet.
    if (
      existingUsage.unreserved &&
      existingUsage.costStatus === "pending" &&
      report.costMicro !== undefined
    ) {
      const expense = await ctx.db
        .query("providerExpenses")
        .withIndex("by_provider_call_id", (q) =>
          q.eq("providerCallId", report.providerCallId),
        )
        .first();

      if (
        expense &&
        (expense.kind !== "paid_call" ||
          expense.organizationId !== existingUsage.organizationId)
      ) {
        console.error("ALERT: unmatched provider expense identity mismatch", {
          providerCallId: report.providerCallId,
        });
        return { ok: false as const, code: "RESERVATION_MISMATCH" as const };
      }

      await ctx.db.patch(existingUsage._id, {
        costStatus: "known",
        costMicro: report.costMicro,
        rawCostUsd: report.rawCostUsd,
      });

      if (expense) {
        await ctx.db.patch(expense._id, {
          costStatus: "known",
          costMicro: report.costMicro,
        });
      } else {
        await ctx.db.insert("providerExpenses", {
          kind: "paid_call",
          providerCallId: report.providerCallId,
          organizationId: existingUsage.organizationId,
          costStatus: "known",
          costMicro: report.costMicro,
          unmatched: true,
          createdAt: now,
        });
      }

      const parked = await ctx.db
        .query("unboundVoiceReports")
        .withIndex("by_provider_call_id", (q) =>
          q.eq("providerCallId", report.providerCallId),
        )
        .first();
      if (parked && parked.costMicro === undefined) {
        await ctx.db.patch(parked._id, {
          costMicro: report.costMicro,
          rawCostUsd: report.rawCostUsd,
        });
      }

      if (!processed) {
        await ctx.db.insert("processedProviderEvents", {
          eventKey,
          provider: "vapi",
          receivedAt: now,
        });
      }

      return { ok: true as const, outcome: "unreserved_cost_reconciled" as const };
    }

    // Unreserved calls are platform expenses and must never debit a tenant.
    if (
      !existingUsage.unreserved &&
      existingUsage.costStatus === "pending" &&
      report.costMicro !== undefined
    ) {
      const reconciliation = await applyActualCost(ctx, {
        providerCallId: report.providerCallId,
        costMicro: report.costMicro,
        rawCostUsd: report.rawCostUsd,
      });

      if (!reconciliation.ok) return reconciliation;

      if (!processed) {
        await ctx.db.insert("processedProviderEvents", {
          eventKey,
          provider: "vapi",
          receivedAt: now,
        });
      }

      return reconciliation;
    }

    if (!processed) {
      await ctx.db.insert("processedProviderEvents", {
        eventKey,
        provider: "vapi",
        receivedAt: now,
      });
    }

    return { ok: true as const, outcome: "duplicate" as const };
  }

  if (processed) {
    return { ok: true as const, outcome: "duplicate" as const };
  }

  const organizationId = await managedOrgFor(ctx, report.assistantId);
  if (!organizationId) return { ok: false as const, code: "UNKNOWN_ASSISTANT" as const };

  const reservation = await ctx.db
    .query("voiceCallReservations")
    .withIndex("by_provider_call_id", (q) => q.eq("providerCallId", report.providerCallId))
    .first();

  if (!reservation) {
    const parked = await ctx.db
      .query("unboundVoiceReports")
      .withIndex("by_provider_call_id", (q) => q.eq("providerCallId", report.providerCallId))
      .first();
    if (!parked) {
      await ctx.db.insert("unboundVoiceReports", { ...report, organizationId, status: "pending", receivedAt: now });
    } else if (parked.status === "pending" && parked.costMicro === undefined && report.costMicro !== undefined) {
      await ctx.db.patch(parked._id, { costMicro: report.costMicro, rawCostUsd: report.rawCostUsd });
    }
    return { ok: true as const, outcome: "pending_binding" as const };
  }

  if (reservation.organizationId !== organizationId || reservation.assistantId !== report.assistantId) {
    console.error("ALERT: provider call bound to a reservation of a different assistant/organization", {
      providerCallId: report.providerCallId,
    });
    return { ok: false as const, code: "RESERVATION_MISMATCH" as const };
  }

  if (reservation.status === "settled") {
    await ctx.db.insert("processedProviderEvents", { eventKey, provider: "vapi", receivedAt: now });
    return { ok: true as const, outcome: "duplicate" as const };
  }
  if (reservation.status === "released_unissued") {
    console.error("ALERT: report for a reservation whose token was never issued", { providerCallId: report.providerCallId });
    return { ok: false as const, code: "RESERVATION_NOT_OPEN" as const };
  }

  const wallet = await ctx.db.get(reservation.walletId);
  if (!wallet) return { ok: false as const, code: "WALLET_NOT_FOUND" as const };

  if (report.overridesDetected) {
    console.error("ALERT: call carried browser assistant overrides", { organizationId, providerCallId: report.providerCallId });
  }

  const costKnown = report.costMicro !== undefined;
  // "authorized" and "pending_cost" still hold budget; "expired_no_report" was
  // already released by the cron and must NOT be released a second time.
  const holdStillHeld = reservation.status === "authorized" || reservation.status === "pending_cost";

  await ctx.db.insert("voiceUsage", {
    organizationId,
    providerCallId: report.providerCallId,
    assistantId: report.assistantId,
    walletId: wallet._id,
    reservationId: reservation._id,
    costStatus: costKnown ? "known" : "pending",
    costMicro: report.costMicro,
    customerChargeMicro: report.costMicro,
    rawCostUsd: report.rawCostUsd,
    durationSeconds: report.durationSeconds,
    startedAtMs: report.startedAtMs,
    endedAtMs: report.endedAtMs,
    endedReason: report.endedReason,
    overridesDetected: report.overridesDetected,
    unreserved: false,
    createdAt: now,
  });

  const priorExpense = await ctx.db
    .query("providerExpenses")
    .withIndex("by_provider_call_id", (q) => q.eq("providerCallId", report.providerCallId))
    .first();
  if (!priorExpense) {
    await ctx.db.insert("providerExpenses", {
      kind: "paid_call",
      providerCallId: report.providerCallId,
      organizationId,
      costStatus: costKnown ? "known" : "pending",
      costMicro: report.costMicro,
      createdAt: now,
    });
  }

  if (costKnown) {
    if (holdStillHeld) {
      await closeHold(ctx, reservation, "settled", "settled", { providerCallId: report.providerCallId });
    } else {
      await ctx.db.patch(reservation._id, { status: "settled", settledAt: now });
    }
    const settlementApplied = await applyTx(ctx, {
      walletId: wallet._id,
      organizationId,
      type: "settle",
      amountMicro: report.costMicro!,
      key: `settle:${report.providerCallId}`,
      reservationId: reservation._id,
      providerCallId: report.providerCallId,
      note: holdStillHeld ? undefined : "late report after hold expiry",
    });

    await recordProviderCostAlerts(ctx, {
      organizationId,
      providerCallId: report.providerCallId,
      reservation,
      wallet,
      actualCostMicro: report.costMicro!,
      resultingSpentMicro:
        wallet.spentMicro + (settlementApplied ? report.costMicro! : 0),
    });
  } else if (reservation.status === "authorized") {
    // Cost unknown: keep the hold until the provider cost is reconciled.
    await ctx.db.patch(reservation._id, { status: "pending_cost" });
  }
  // (expired + cost unknown: the cost-reconcile path debits the wallet later.)

  await ctx.db.insert("processedProviderEvents", { eventKey, provider: "vapi", receivedAt: now });
  return { ok: true as const, outcome: costKnown ? ("settled" as const) : ("pending_cost" as const) };
}

export const settlePaidCall = internalMutation({
  args: { eventKey: v.string(), ...reportFields },
  handler: async (ctx, args) => {
    const { eventKey, ...report } = args;
    return settleReport(ctx, eventKey, report);
  },
});

/** After a verified binding: settle a report that arrived early. */
export const settlePendingReport = internalMutation({
  args: { providerCallId: v.string() },
  handler: async (ctx, args) => {
    const parked = await ctx.db
      .query("unboundVoiceReports")
      .withIndex("by_provider_call_id", (q) => q.eq("providerCallId", args.providerCallId))
      .first();
    if (!parked || parked.status !== "pending") return { ok: true as const, outcome: "nothing_pending" as const };

    const { _id, _creationTime, status, receivedAt, organizationId, ...report } = parked;
    void status; void receivedAt; void organizationId; void _creationTime;
    const result = await settleReport(ctx, `pending:${args.providerCallId}`, report);
    if (result.ok && result.outcome !== "pending_binding") await ctx.db.patch(_id, { status: "settled" });
    return result;
  },
});

/**
 * Cron: provider reports that never got a verified binding. The cost is
 * recorded for platform reconciliation (providerExpenses + voiceUsage marked
 * unreserved/unmatched) but NO wallet is debited and no reservation is
 * touched: an unverifiable call must never be charged to a tenant by guess.
 */

export const reconcileUnboundReports = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - UNBOUND_REPORT_GRACE_MS;

    const stale = await ctx.db
      .query("unboundVoiceReports")
      .withIndex("by_status_and_received_at", (q) =>
        q.eq("status", "pending").lte("receivedAt", cutoff),
      )
      .take(100);

    let unmatched = 0;
    let settled = 0;
    let deferred = 0;

    for (const report of stale) {
      // First check whether this exact provider call has since been
      // verified and bound to a reservation.
      const reservation = await ctx.db
        .query("voiceCallReservations")
        .withIndex("by_provider_call_id", (q) =>
          q.eq("providerCallId", report.providerCallId),
        )
        .first();

      if (reservation) {
        // Never classify a bound call as an unreserved platform expense.
        // Reuse the same settlement core and idempotency key as
        // settlePendingReport.
        const providerReport: ProviderReport = {
          providerCallId: report.providerCallId,
          assistantId: report.assistantId,
          costMicro: report.costMicro,
          rawCostUsd: report.rawCostUsd,
          durationSeconds: report.durationSeconds,
          startedAtMs: report.startedAtMs,
          endedAtMs: report.endedAtMs,
          endedReason: report.endedReason,
          overridesDetected: report.overridesDetected,
        };

        const result = await settleReport(
          ctx,
          `pending:${report.providerCallId}`,
          providerReport,
        );

        if (result.ok && result.outcome !== "pending_binding") {
          await ctx.db.patch(report._id, { status: "settled" });
          settled++;
        } else {
          // Keep it pending so a later cron execution can retry.
          // Do not create an unmatched platform expense here.
          deferred++;

          console.error(
            "ALERT: bound Vapi report settlement deferred",
            {
              providerCallId: report.providerCallId,
              code: result.ok ? result.outcome : result.code,
            },
          );
        }

        continue;
      }

      // No exact reservation exists. Preserve the original safe
      // platform-expense handling. Never debit a tenant by guessing.
      const known = report.costMicro !== undefined;

      const hasUsage = await ctx.db
        .query("voiceUsage")
        .withIndex("by_provider_call_id", (q) =>
          q.eq("providerCallId", report.providerCallId),
        )
        .first();

      if (!hasUsage) {
        await ctx.db.insert("voiceUsage", {
          organizationId: report.organizationId,
          providerCallId: report.providerCallId,
          assistantId: report.assistantId,
          costStatus: known ? "known" : "pending",
          costMicro: report.costMicro,
          rawCostUsd: report.rawCostUsd,
          durationSeconds: report.durationSeconds,
          startedAtMs: report.startedAtMs,
          endedAtMs: report.endedAtMs,
          endedReason: report.endedReason,
          overridesDetected: report.overridesDetected,
          unreserved: true,
          createdAt: Date.now(),
        });
      }

      const expense = await ctx.db
        .query("providerExpenses")
        .withIndex("by_provider_call_id", (q) =>
          q.eq("providerCallId", report.providerCallId),
        )
        .first();

      if (!expense) {
        await ctx.db.insert("providerExpenses", {
          kind: "paid_call",
          providerCallId: report.providerCallId,
          organizationId: report.organizationId,
          costStatus: known ? "known" : "pending",
          costMicro: report.costMicro,
          unmatched: true,
          createdAt: Date.now(),
        });
      }

      console.error(
        "ALERT: provider call never bound to a reservation; no wallet debited",
        {
          providerCallId: report.providerCallId,
          organizationId: report.organizationId,
        },
      );

      await ctx.db.patch(report._id, { status: "unmatched" });
      unmatched++;
    }

    return { unmatched, settled, deferred };
  },
});


/**
 * Reconciliation core.
 *
 * This is a plain function so another mutation can call it inside its
 * own transaction without creating a nested mutation.
 */
export async function applyActualCost(
  ctx: MutationCtx,
  args: {
    providerCallId: string;
    costMicro: number;
    rawCostUsd?: number;
  },
) {
  if (!isMicro(args.costMicro)) {
    return { ok: false as const, code: "INVALID" as const };
  }

  const usage = await ctx.db
    .query("voiceUsage")
    .withIndex("by_provider_call_id", (q) =>
      q.eq("providerCallId", args.providerCallId),
    )
    .first();

  if (!usage) {
    return { ok: false as const, code: "UNKNOWN_CALL" as const };
  }

  if (usage.costStatus === "known") {
    return { ok: true as const, outcome: "duplicate" as const };
  }

  // Unbound provider reports are platform-level expenses, never tenant charges.
  if (usage.unreserved) {
    return { ok: false as const, code: "UNBILLABLE_CALL" as const };
  }

  if (!usage.walletId || !usage.reservationId) {
    return { ok: false as const, code: "RESERVATION_MISSING" as const };
  }

  const reservation = await ctx.db.get(usage.reservationId);
  if (
    !reservation ||
    reservation.organizationId !== usage.organizationId ||
    reservation.assistantId !== usage.assistantId ||
    reservation.walletId !== usage.walletId ||
    reservation.providerCallId !== args.providerCallId
  ) {
    return { ok: false as const, code: "RESERVATION_MISMATCH" as const };
  }

  if (
    reservation.status !== "pending_cost" &&
    reservation.status !== "expired_no_report"
  ) {
    return { ok: false as const, code: "RESERVATION_NOT_RECONCILABLE" as const };
  }

  const wallet = await ctx.db.get(usage.walletId);
  if (!wallet || wallet.organizationId !== usage.organizationId) {
    return { ok: false as const, code: "WALLET_NOT_FOUND" as const };
  }

  // Verify any pre-existing settlement key instead of silently trusting it.
  const settlementKey = `settle:${args.providerCallId}`;
  const existingSettlement = await ctx.db
    .query("voiceWalletTransactions")
    .withIndex("by_idempotency_key", (q) =>
      q.eq("idempotencyKey", settlementKey),
    )
    .first();

  if (
    existingSettlement &&
    (
      existingSettlement.walletId !== usage.walletId ||
      existingSettlement.organizationId !== usage.organizationId ||
      existingSettlement.type !== "settle" ||
      existingSettlement.amountMicro !== args.costMicro ||
      existingSettlement.providerCallId !== args.providerCallId ||
      existingSettlement.reservationId !== usage.reservationId
    )
  ) {
    console.error("ALERT: conflicting voice settlement ledger transaction", {
      providerCallId: args.providerCallId,
    });
    return { ok: false as const, code: "LEDGER_MISMATCH" as const };
  }

  // A pending-cost reservation still has its hold; an expired one does not.
  if (reservation.status === "pending_cost") {
    await closeHold(ctx, reservation, "settled", "settled", {
      providerCallId: args.providerCallId,
    });
  } else {
    await ctx.db.patch(reservation._id, {
      status: "settled",
      settledAt: Date.now(),
    });
  }

  let settlementApplied = false;

  if (!existingSettlement) {
    settlementApplied = await applyTx(ctx, {
      walletId: usage.walletId,
      organizationId: usage.organizationId,
      type: "settle",
      amountMicro: args.costMicro,
      key: settlementKey,
      reservationId: usage.reservationId,
      providerCallId: args.providerCallId,
      note: "reconciled provider cost",
    });
  }

  await ctx.db.patch(usage._id, {
    costStatus: "known",
    costMicro: args.costMicro,
    customerChargeMicro: args.costMicro,
    rawCostUsd: args.rawCostUsd,
  });

  const providerExpense = await ctx.db
    .query("providerExpenses")
    .withIndex("by_provider_call_id", (q) =>
      q.eq("providerCallId", args.providerCallId),
    )
    .first();

  if (providerExpense) {
    await ctx.db.patch(providerExpense._id, {
      costStatus: "known",
      costMicro: args.costMicro,
    });
  }

  await recordProviderCostAlerts(ctx, {
    organizationId: usage.organizationId,
    providerCallId: args.providerCallId,
    reservation,
    wallet,
    actualCostMicro: args.costMicro,
    resultingSpentMicro:
      wallet.spentMicro + (settlementApplied ? args.costMicro : 0),
  });

  return { ok: true as const, outcome: "settled" as const };
}
export const recordActualCost = internalMutation({
  args: {
    providerCallId: v.string(),
    costMicro: v.number(),
    rawCostUsd: v.optional(v.number()),
  },

  handler: (ctx, args) => applyActualCost(ctx, args),
});

/**
 * Cron: expire authorized reservations whose hold deadline has passed.
 */
export const expireHolds = internalMutation({
  args: {},

  handler: async (ctx) => {
    const now = Date.now();

    const dueReservations = await ctx.db
      .query("voiceCallReservations")
      .withIndex("by_status_and_hold_deadline", (q) =>
        q.eq("status", "authorized").lte("holdDeadline", now),
      )
      .take(100);

    for (const reservation of dueReservations) {
      await closeHold(ctx, reservation, "expired_no_report", "expired", {
        note: "no provider event by hold deadline",
      });
    }

    return {
      expired: dueReservations.length,
    };
  },
});

/**
 * Record the platform's actual expense for a free promotional demo.
 *
 * Free-demo usage does not debit a paid customer wallet.
 * organizationId is optional because the current schema does not define
 * a voiceSessions table from which it can safely be inferred.
 */
export const recordFreeDemoExpense = internalMutation({
  args: {
    providerCallId: v.string(),
    costMicro: v.optional(v.number()),
    organizationId: v.optional(v.string()),
  },

  handler: async (ctx, args) => {
    if (args.costMicro !== undefined && !isMicro(args.costMicro)) {
      return { recorded: false as const };
    }

    const existing = await ctx.db
      .query("providerExpenses")
      .withIndex("by_provider_call_id", (q) =>
        q.eq("providerCallId", args.providerCallId),
      )
      .first();

    if (existing) {
      if (existing.costStatus === "pending" && args.costMicro !== undefined) {
        await ctx.db.patch(existing._id, {
          costStatus: "known",
          costMicro: args.costMicro,
        });

        return { recorded: true as const, reconciled: true as const };
      }

      return { recorded: false as const };
    }

    await ctx.db.insert("providerExpenses", {
      kind: "free_demo",
      providerCallId: args.providerCallId,
      organizationId: args.organizationId,
      costStatus: args.costMicro !== undefined ? "known" : "pending",
      costMicro: args.costMicro,
      createdAt: Date.now(),
    });

    return { recorded: true as const, reconciled: false as const };
  },
});