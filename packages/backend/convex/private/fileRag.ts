
import { v } from "convex/values";
import { vEntryId } from "@convex-dev/rag";
import { internalMutation, internalQuery } from "../_generated/server";
import rag from "../system/ai/rag";
import { Id } from "../_generated/dataModel";

type EntryMetadata = {
  storageId: Id<"_storage">;
  uploadedBy: string;
  filename: string;
  category: string | null;
};

export const addRagEntry = internalMutation({
  args: {
    organizationId: v.string(),
    text: v.string(),
    filename: v.string(),
    category: v.union(v.string(), v.null()),
    storageId: v.id("_storage"),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const { entryId, created, replacedEntry } = await rag.add(ctx, {
      namespace: args.organizationId,
      text: args.text,
      key: args.filename,
      title: args.filename,
      metadata: {
        storageId: args.storageId,
        uploadedBy: args.organizationId,
        filename: args.filename,
        category: args.category,
      } as EntryMetadata,
      contentHash: args.contentHash,
    });

    const oldStorageId = (replacedEntry?.metadata as EntryMetadata | undefined)
      ?.storageId;

    return {
      entryId,
      created,
      oldStorageId: oldStorageId ?? null,
    };
  },
});

export const getOwnedStorageId = internalQuery({
  args: {
    organizationId: v.string(),
    entryId: vEntryId,
  },
  handler: async (ctx, args) => {
    const namespace = await rag.getNamespace(ctx, {
      namespace: args.organizationId,
    });

    if (!namespace) return null;

    // Download links must work for an owned file throughout ingestion,
    // including the pending state before embeddings finish.
    let found = false;

    for (const status of ["pending", "ready", "replaced"] as const) {
      let cursor: string | null = null;
      let isDone = false;

      while (!isDone) {
        const result = await rag.list(ctx, {
          namespaceId: namespace.namespaceId,
          paginationOpts: { cursor, numItems: 100 },
          status,
        });

        if (result.page.some((item) => item.entryId === args.entryId)) {
          found = true;
          break;
        }

        cursor = result.continueCursor;
        isDone = result.isDone;
      }

      if (found) break;
    }

    if (!found) return null;

    const entry = await rag.getEntry(ctx, {
      entryId: args.entryId,
    });

    const metadata = entry?.metadata as EntryMetadata | undefined;

    if (
      !entry ||
      metadata?.uploadedBy !== args.organizationId ||
      !metadata.storageId
    ) {
      return null;
    }

    return metadata.storageId;
  },
});
