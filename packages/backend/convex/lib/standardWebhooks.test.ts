import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStandardWebhook, type WebhookHeaders } from "./standardWebhooks";

const SECRET = "polar_whs_test_secret_value";
const NOW_MS = Date.UTC(2026, 9, 30, 12, 0, 0);
const NOW_S = NOW_MS / 1000;
const BODY = JSON.stringify({ type: "subscription.updated", data: { id: "sub_123" } });

/** Sign exactly like the Standard Webhooks spec: key = secret's UTF-8 bytes. */
const sign = (id: string, ts: string, body: string, secret = SECRET) =>
  createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${ts}.${body}`).digest("base64");

const headers = (over: Partial<WebhookHeaders> = {}, ts = String(NOW_S)): WebhookHeaders => ({
  id: "evt_1",
  timestamp: ts,
  signature: `v1,${sign("evt_1", ts, BODY)}`,
  ...over,
});

const verify = (h: WebhookHeaders, body = BODY, secret = SECRET, now = NOW_MS) =>
  verifyStandardWebhook(body, h, secret, now);

describe("verifyStandardWebhook: accepts", () => {
  it("a correctly signed request", async () => {
    expect(await verify(headers())).toBe(true);
  });

  it("when one of several signatures is valid (secret rotation)", async () => {
    const good = sign("evt_1", String(NOW_S), BODY);
    const h = headers({ signature: `v1,AAAAAAAA v1,${good}` });
    expect(await verify(h)).toBe(true);
  });

  it("when an unknown signature version precedes the valid v1 entry", async () => {
    const good = sign("evt_1", String(NOW_S), BODY);
    expect(await verify(headers({ signature: `v2,abc v1,${good}` }))).toBe(true);
  });

  it("a timestamp just inside the tolerance, past and future", async () => {
    for (const offset of [-299, 299]) {
      const ts = String(NOW_S + offset);
      expect(await verify(headers({ signature: `v1,${sign("evt_1", ts, BODY)}` }, ts))).toBe(true);
    }
  });
});

describe("verifyStandardWebhook: rejects", () => {
  it("a tampered body", async () => {
    expect(await verify(headers(), BODY.replace("sub_123", "sub_999"))).toBe(false);
  });

  it("a tampered webhook id", async () => {
    expect(await verify(headers({ id: "evt_2" }))).toBe(false);
  });

  it("a signature made with a different secret", async () => {
    const h = headers({ signature: `v1,${sign("evt_1", String(NOW_S), BODY, "other")}` });
    expect(await verify(h)).toBe(false);
  });

  it("an empty configured secret", async () => {
    expect(await verify(headers(), BODY, "")).toBe(false);
  });

  it("a timestamp outside the tolerance, past and future (replay protection)", async () => {
    for (const offset of [-301, 301]) {
      const ts = String(NOW_S + offset);
      expect(await verify(headers({ signature: `v1,${sign("evt_1", ts, BODY)}` }, ts))).toBe(false);
    }
  });

  it("a non-numeric timestamp", async () => {
    expect(await verify(headers({ timestamp: "yesterday" }))).toBe(false);
  });

  it.each(["id", "timestamp", "signature"] as const)("a missing %s header", async (field) => {
    expect(await verify(headers({ [field]: "" }))).toBe(false);
  });

  it.each([
    ["no version separator", "garbage"],
    ["empty signature", "v1,"],
    ["invalid base64", "v1,!!!not-base64!!!"],
    ["wrong-length but valid base64", "v1,AAAA"],
  ])("a malformed signature entry (%s)", async (_label, signature) => {
    expect(await verify(headers({ signature }))).toBe(false);
  });

  it("a valid signature under an unsupported version only", async () => {
    const good = sign("evt_1", String(NOW_S), BODY);
    expect(await verify(headers({ signature: `v2,${good}` }))).toBe(false);
  });
});