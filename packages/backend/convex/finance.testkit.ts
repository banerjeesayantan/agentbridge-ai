/** Shared helpers for the paid-voice finance tests. Not a test file. */
import { convexTest } from "convex-test";
import type { SchemaDefinition } from "convex/server";
import { vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules } from "./test.setup";

type TablesOf<S> =
  S extends SchemaDefinition<infer Tables, boolean> ? Tables : never;
export type T = ReturnType<typeof convexTest<TablesOf<typeof schema>>>;
export const DAY = 24 * 60 * 60 * 1000;

export const newT = (): T => convexTest(schema, modules);
export type { Id };

/** Env that makes paid voice ready: 600 s calls at 250_000 micro-dollars/minute => 2_500_000 held per call. */
export function stubVoiceEnv(over: Record<string, string> = {}) {
  const env = {
    VOICE_PAID_MAX_CALL_SECONDS: "600",
    VOICE_MAX_COST_PER_MINUTE_MICRO: "250000",
    VOICE_ALLOWED_ORIGINS: "https://widget.example.com",
    ...over,
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

/**
 * org_A: pro, active, with a managed assistant and two visitors.
 * org_B: business, active, with its own managed assistant and one visitor.
 * org_F: no subscription (Free) with a visitor and no assistant.
 */
export async function seed(t: T, now = Date.now()) {
  return await t.run(async (ctx) => {
    const sub = (organizationId: string, plan: "pro" | "enterprise") =>
      ctx.db.insert("subscriptions", {
        organizationId,
        status: "active",
        plan,
        currentPeriodStart: now - 10 * DAY,
        currentPeriodEnd: now + 20 * DAY,
      });
    await sub("org_A", "pro");
    await sub("org_B", "enterprise");

    const visitor = (organizationId: string, expiresAt = now + DAY) =>
      ctx.db.insert("contactSessions", {
        name: "V",
        email: "v@example.com",
        organizationId,
        expiresAt,
      });
    const A1 = await visitor("org_A");
    const A2 = await visitor("org_A");
    const B1 = await visitor("org_B");
    const F1 = await visitor("org_F");
    const A_expired = await visitor("org_A", now - 1000);

    const assistant = (organizationId: string, vapiAssistantId: string) =>
      ctx.db.insert("managedAssistants", {
        organizationId,
        vapiAssistantId,
        createdAt: now,
        createdBy: "user_admin",
      });
    await assistant("org_A", "asst_A");
    await assistant("org_B", "asst_B");

    return { A1, A2, B1, F1, A_expired, periodStart: now - 10 * DAY };
  });
}

/** The wallet aggregates must always equal what the append-only ledger says. */
export async function assertLedgerInvariants(t: T) {
  const result = await t.run(async (ctx) => {
    const problems: string[] = [];
    for (const w of await ctx.db.query("voiceWallets").collect()) {
      const txs = await ctx.db
        .query("voiceWalletTransactions")
        .withIndex("by_wallet_id", (q) => q.eq("walletId", w._id))
        .collect();
      const sum = (type: string) =>
        txs
          .filter((x) => x.type === type)
          .reduce((s, x) => s + x.amountMicro, 0);
      if (w.budgetMicro !== sum("grant"))
        problems.push(`budget ${w.budgetMicro} != grants ${sum("grant")}`);
      if (w.reservedMicro !== sum("reserve") - sum("release"))
        problems.push(
          `reserved ${w.reservedMicro} != ${sum("reserve")} - ${sum("release")}`,
        );
      if (w.spentMicro !== sum("settle"))
        problems.push(`spent ${w.spentMicro} != settles ${sum("settle")}`);
      if (w.reservedMicro < 0 || w.spentMicro < 0 || w.budgetMicro < 0)
        problems.push("negative aggregate");
      const keys = txs.map((x) => x.idempotencyKey);
      if (new Set(keys).size !== keys.length)
        problems.push("duplicate idempotency key");
    }
    return problems;
  });
  if (result.length)
    throw new Error(`Ledger invariants violated: ${result.join("; ")}`);
}

export const wallets = (t: T) =>
  t.run((ctx) => ctx.db.query("voiceWallets").collect());
export const walletFor = (t: T, org: string) =>
  t.run(
    async (ctx) =>
      (await ctx.db.query("voiceWallets").collect()).find(
        (w) => w.organizationId === org,
      ) ?? null,
  );
