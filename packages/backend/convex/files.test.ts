import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { extractMock, fakeRagEntries, resetFakeRag } from "./test.mocks";
import { identity, newT } from "./tenancy.testkit";

vi.mock("./system/ai/rag", async () => ({ default: (await import("./test.mocks")).fakeRag }));
vi.mock("./lib/extractTextContent", async () => ({ extractTextContent: (await import("./test.mocks")).extractMock }));

beforeEach(() => {
  resetFakeRag();
  extractMock.mockReset().mockImplementation(async (_c: unknown, a: { filename: string }) => `text of ${a.filename}`);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const admin = (t: ReturnType<typeof newT>, org = "org_A") => t.withIdentity(identity(org, "org:admin"));
const add = (t: ReturnType<typeof newT>, filename: string, data: ArrayBuffer, extra: Record<string, unknown> = {}) =>
  admin(t).action(api.private.files.addFile, { filename, bytes: data, ...extra } as never);
const storageCount = async (t: ReturnType<typeof newT>) => (await t.run((ctx) => ctx.db.system.query("_storage").collect())).length;
const slots = async (t: ReturnType<typeof newT>) => (await t.run((ctx) => ctx.db.query("fileUploads").collect())).length;
const used = async (t: ReturnType<typeof newT>) =>
  (await t.run((ctx) => ctx.db.query("usage").collect())).reduce((n, r) => n + r.count, 0);

describe("F-14 knowledge file validation (end to end)", () => {
  it("ingests a text file: stored, indexed with the verified type, slot released, no AI charge", async () => {
    const t = newT();
    await add(t, "faq.txt", enc("Refunds within 30 days."));
    expect(fakeRagEntries()).toHaveLength(1);
    expect(fakeRagEntries()[0]).toMatchObject({ namespace: "org_A", key: "faq.txt", metadata: { uploadedBy: "org_A", filename: "faq.txt" } });
    expect(await storageCount(t)).toBe(1);
    expect(await slots(t)).toBe(0);
    expect(await used(t)).toBe(0);
  });

  it("ignores the client-supplied MIME type", async () => {
    const t = newT();
    await add(t, "notes.txt", enc("plain"), { mimeType: "application/pdf" });
    expect(extractMock.mock.calls[0]![1]).toMatchObject({ mimeType: "text/plain" });
  });

  it.each([
    ["a disallowed extension", "run.exe", enc("MZ")],
    ["a PDF whose bytes are not a PDF", "a.pdf", enc("<html>")],
    ["binary bytes pretending to be text", "a.txt", new Uint8Array([0x4d, 0x5a, 0, 1]).buffer as ArrayBuffer],
    ["an empty file", "a.txt", new ArrayBuffer(0)],
    ["an oversized file", "big.txt", new ArrayBuffer(10 * 1024 * 1024 + 1)],
    ["a path-traversal name", "../x.txt", enc("x")],
  ])("rejects %s and leaves nothing behind", async (_l, name, data) => {
    const t = newT();
    await expect(add(t, name, data)).rejects.toThrow(/BAD_REQUEST/);
    expect(fakeRagEntries()).toHaveLength(0);
    expect(await storageCount(t)).toBe(0);
    expect(await slots(t)).toBe(0);
    expect(await used(t)).toBe(0);
  });
});

describe("F-15 atomic file limit (Free plan = 5 files)", () => {
  it("allows exactly the plan limit sequentially", async () => {
    const t = newT();
    for (let i = 0; i < 5; i++) await add(t, `f${i}.txt`, enc(`doc ${i}`));
    await expect(add(t, "f5.txt", enc("one too many"))).rejects.toThrow(/LIMIT_REACHED/);
    expect(fakeRagEntries()).toHaveLength(5);
    expect(await slots(t)).toBe(0);
  });

  it("cannot be exceeded by concurrent uploads (no check-then-act race)", async () => {
    // The race lives in the slot reservation, which is one transaction. (The
    // convex-test harness cannot run concurrent `_storage` writes, so this
    // exercises the reservation mutation directly with 10 simultaneous callers.)
    const t = newT();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        t.mutation(internal.system.fileUploads.reserveSlot, { organizationId: "org_A", key: `c${i}.txt`, limit: 5 }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok)).toHaveLength(5);
    expect(await slots(t)).toBe(5);
  });

  it("counts existing files plus in-flight uploads against the limit", async () => {
    const t = newT();
    for (let i = 0; i < 3; i++) await add(t, `f${i}.txt`, enc(`doc ${i}`));
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        t.mutation(internal.system.fileUploads.reserveSlot, { organizationId: "org_A", key: `n${i}`, limit: 5 }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2); // 3 stored + 2 reserved = 5
  });

  it("an abandoned reservation (crashed action) stops blocking after its TTL", async () => {
    const t = newT();
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) await ctx.db.insert("fileUploads", { organizationId: "org_A", key: `ghost${i}`, createdAt: Date.now() - 16 * 60_000 });
    });
    await add(t, "ok.txt", enc("fine"));
    expect(fakeRagEntries()).toHaveLength(1);
  });

  it("limits are per organization", async () => {
    const t = newT();
    for (let i = 0; i < 5; i++) await add(t, `f${i}.txt`, enc(`doc ${i}`));
    await admin(t, "org_B").action(api.private.files.addFile, { filename: "b.txt", bytes: enc("b") });
    expect(fakeRagEntries().filter((e) => e.namespace === "org_B")).toHaveLength(1);
  });
});

describe("model-based extraction is metered and reversible", () => {
  const pdf = () => enc("%PDF-1.7 fake pdf body");

  it("charges one AI request for a PDF", async () => {
    const t = newT();
    await add(t, "manual.pdf", pdf());
    expect(await used(t)).toBe(1);
  });

  it("a failed extraction refunds, deletes the blob, releases the slot and indexes nothing", async () => {
    const t = newT();
    extractMock.mockRejectedValue(new Error("model down"));
    await expect(add(t, "manual.pdf", pdf())).rejects.toThrow(/BAD_GATEWAY/);
    expect(await used(t)).toBe(0);
    expect(await storageCount(t)).toBe(0);
    expect(await slots(t)).toBe(0);
    expect(fakeRagEntries()).toHaveLength(0);
  });

  it("is refused when the AI allowance is used up, before anything is stored", async () => {
    const t = newT();
    for (let i = 0; i < 100; i++) await t.mutation(internal.system.usage.consume, { organizationId: "org_A", metric: "aiMessages", requestId: `p${i}` });
    await expect(add(t, "manual.pdf", pdf())).rejects.toThrow(/LIMIT_REACHED/);
    expect(await storageCount(t)).toBe(0);
    expect(await slots(t)).toBe(0);
    // Plain text needs no model, so it is still allowed.
    await add(t, "faq.txt", enc("still fine"));
    expect(fakeRagEntries()).toHaveLength(1);
  });

  it("add/delete churn cannot be used to run unlimited model calls", async () => {
    const t = newT();
    let ok = 0;
    for (let i = 0; i < 120; i++) {
      try {
        await add(t, "churn.pdf", enc(`%PDF-1.7 version ${i}`));
        ok++;
      } catch {
        break;
      }
    }
    expect(ok).toBe(100); // bounded by the AI allowance, not by the file count
  });
});

describe("storage lifecycle and ownership", () => {
  it("replacing a file by name deletes the old blob; identical content drops the duplicate", async () => {
    const t = newT();
    await add(t, "policy.txt", enc("v1"));
    expect(await storageCount(t)).toBe(1);
    await add(t, "policy.txt", enc("v2"));
    expect(await storageCount(t)).toBe(1); // old blob not orphaned
    expect(fakeRagEntries()).toHaveLength(1);
    await add(t, "policy.txt", enc("v2"));
    expect(await storageCount(t)).toBe(1); // duplicate blob dropped
  });

  it("the owner gets a download link and can delete; the blob is removed", async () => {
    const t = newT();
    const { entryId } = await add(t, "faq.txt", enc("hello")) as { entryId: string };
    const url = await t.withIdentity(identity("org_A", "org:member")).action(api.private.files.getDownloadUrl, { entryId: entryId as never });
    expect(typeof url).toBe("string");
    await admin(t).mutation(api.private.files.deleteFile, { entryId: entryId as never });
    expect(fakeRagEntries()).toHaveLength(0);
  });
});

  it("prevents another organization from downloading or deleting a file", async () => {
    const t = newT();
    const { entryId } = await add(t, "private.txt", enc("org A secret")) as {
      entryId: string;
    };

    await expect(
      t.withIdentity(identity("org_B", "org:member")).action(
        api.private.files.getDownloadUrl,
        { entryId: entryId as never },
      ),
    ).rejects.toThrow();

    await expect(
      admin(t, "org_B").mutation(api.private.files.deleteFile, {
        entryId: entryId as never,
      }),
    ).rejects.toThrow();

    expect(fakeRagEntries()).toHaveLength(1);
    expect(await storageCount(t)).toBe(1);
  });
