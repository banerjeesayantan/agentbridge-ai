import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import { newT, type T } from "../finance.testkit";
import { handlePolarOrderEvent } from "./polarOrderHandler";

beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
});

const order = (over: Record<string, unknown> = {}) => ({
  id: "ord_1",
  status: "paid",
  paid: true,
  currency: "usd",
  net_amount: 5_900,
  tax_amount: 400,
  refunded_amount: 0,
  platform_fee_amount: 250,
  customer: { id: "c", external_id: "org_A" },
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});
const run = (t: T, type: string, data: unknown) =>
  handlePolarOrderEvent(
    { runMutation: (ref, args) => t.mutation(ref, args) },
    internal.system.revenue.applyPolarOrderEvent,
    type,
    data,
    "wh_1",
    Date.now(),
  );
const entries = (t: T) =>
  t.run((ctx) => ctx.db.query("revenueEntries").collect());

describe("handlePolarOrderEvent", () => {
  it("records revenue for a verified paid order and acknowledges with 200", async () => {
    const t = newT();
    expect(await run(t, "order.paid", order())).toEqual({ status: 200 });
    expect(
      (await entries(t)).map((e) => [e.kind, e.amountMicro]).sort(),
    ).toEqual([
      ["payment", 59_000_000],
      ["platform_fee", 2_500_000],
    ]);
  });

  it("is idempotent under redelivery", async () => {
    const t = newT();
    await run(t, "order.paid", order());
    await run(t, "order.paid", order());
    expect(await entries(t)).toHaveLength(2);
  });

  it("acknowledges and ignores customers that are not our organizations", async () => {
    const t = newT();
    expect(
      await run(t, "order.paid", order({ customer: { id: "c" } })),
    ).toEqual({ status: 200 });
    expect(await entries(t)).toHaveLength(0);
  });

  it("alerts but does not retry a malformed event for a linked organization", async () => {
    const t = newT();
    expect(await run(t, "order.paid", order({ currency: "eur" }))).toEqual({
      status: 200,
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("ALERT"),
      expect.objectContaining({ reason: "unsupported currency" }),
    );
    expect(await entries(t)).toHaveLength(0);
  });

  it("asks Polar to retry only when recording genuinely fails", async () => {
    const failing = {
      runMutation: async () => {
        throw new Error("db down");
      },
    };
    expect(
      await handlePolarOrderEvent(
        failing,
        null,
        "order.paid",
        order(),
        "wh",
        Date.now(),
      ),
    ).toEqual({ status: 500 });
  });

  it("does not fund anything from a refunded-only or unpaid event", async () => {
    const t = newT();
    expect(
      await run(t, "order.paid", order({ status: "pending", paid: false })),
    ).toEqual({ status: 200 });
    expect(await entries(t)).toHaveLength(0);
  });
});
