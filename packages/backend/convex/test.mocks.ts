/**
 * Deterministic in-memory stand-ins for the Convex RAG and Agent components
 * (the real ones need a live deployment) so authorization, metering and
 * ingestion logic can be tested. These are MOCKS: they prove our logic, not
 * the behaviour of the real components or of any LLM provider.
 */
import { vi } from "vitest";

type FakeEntry = {
  entryId: string;
  key?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  contentHash?: string;
  status: "ready";
  namespace: string;
};

const state = { namespaces: new Map<string, { namespaceId: string }>(), entries: new Map<string, FakeEntry>(), seq: 0 };

export const resetFakeRag = () => {
  state.namespaces.clear();
  state.entries.clear();
  state.seq = 0;
};
export const fakeRagEntries = () => [...state.entries.values()];

export const fakeRag = {
  getNamespace: async (_ctx: unknown, a: { namespace: string }) => state.namespaces.get(a.namespace) ?? null,
  list: async (_ctx: unknown, a: { namespaceId: string; paginationOpts: { numItems: number } }) => {
    const ns = [...state.namespaces.entries()].find(([, v]) => v.namespaceId === a.namespaceId)?.[0];
    const page = [...state.entries.values()].filter((e) => e.namespace === ns).slice(0, a.paginationOpts.numItems);
    return { page, isDone: true, continueCursor: "" };
  },
  getEntry: async (_ctx: unknown, a: { entryId: string }) => state.entries.get(a.entryId) ?? null,
  add: async (_ctx: unknown, a: { namespace: string; key?: string; title?: string; metadata?: Record<string, unknown>; contentHash?: string }) => {
    if (!state.namespaces.has(a.namespace)) state.namespaces.set(a.namespace, { namespaceId: `ns_${a.namespace}` });
    const old = [...state.entries.values()].find((e) => e.namespace === a.namespace && e.key === a.key);
    if (old && old.contentHash === a.contentHash) return { entryId: old.entryId, created: false, replacedEntry: null };
    if (old) state.entries.delete(old.entryId);
    const entryId = `entry_${++state.seq}`;
    state.entries.set(entryId, { entryId, key: a.key, title: a.title, metadata: a.metadata, contentHash: a.contentHash, status: "ready", namespace: a.namespace });
    return { entryId, created: true, replacedEntry: old ?? null };
  },
  deleteAsync: async (_ctx: unknown, a: { entryId: string }) => {
    state.entries.delete(a.entryId);
  },
  search: async () => ({ entries: [], text: "" }),
};

export const agentMocks = {
  generateText: vi.fn(async (..._args: unknown[]) => ({})),
  listMessages: vi.fn(async () => ({ page: [], isDone: true, continueCursor: "" })),
  createThread: vi.fn(async () => ({ threadId: "thread_new" })),
  saveMessage: vi.fn(async () => ({ messageId: `msg_${Math.random().toString(36).slice(2)}` })),
};

export const extractMock = vi.fn(async (_ctx: unknown, args: { filename: string }) => `extracted text of ${args.filename}`);
