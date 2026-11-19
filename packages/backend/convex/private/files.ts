import { requireOrg, requireRole } from "../lib/auth";
import { ConvexError, v } from "convex/values";
import {
  contentHashFromArrayBuffer,
  Entry,
  EntryId,
  vEntryId,
} from "@convex-dev/rag";
import { action, mutation, query, QueryCtx } from "../_generated/server";
import { extractTextContent } from "../lib/extractTextContent";
import rag from "../system/ai/rag";
import { Id } from "../_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { internal } from "../_generated/api";
import { limitError } from "../lib/entitlements";
import { INPUT, assertOptionalText } from "../lib/limits";
import { validateUpload } from "../lib/fileValidation";


export const deleteFile = mutation({
  args: {
    entryId: vEntryId,
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireRole(ctx, "admin");

    const namespace = await rag.getNamespace(ctx, {
      namespace: orgId,
    });

    if (!namespace) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Not found" });
    }

    let cursor: string | null = null;
    let isDone = false;
    let found = false;

    while (!isDone) {
      const result = await rag.list(ctx, {
        namespaceId: namespace.namespaceId,
        paginationOpts: { cursor, numItems: 100 },
        status: "ready",
      });

      if (result.page.some((item) => item.entryId === args.entryId)) {
        found = true;
        break;
      }

      cursor = result.continueCursor;
      isDone = result.isDone;
    }

    if (!found) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Not found" });
    }

    const entry = await rag.getEntry(ctx, {
      entryId: args.entryId,
    });

    if (!entry || entry.metadata?.uploadedBy !== orgId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Not found" });
    }

    if (entry.metadata?.storageId) {
      await ctx.storage.delete(entry.metadata.storageId as Id<"_storage">);
    }

    await rag.deleteAsync(ctx, {
      entryId: args.entryId,
    });
  },
});


export const addFile = action({
  args: {
    filename: v.string(),
    // Accepted for backwards compatibility with older clients; IGNORED. The
    // type is derived and verified server-side (lib/fileValidation.ts).
    mimeType: v.optional(v.string()),
    bytes: v.bytes(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ entryId: EntryId }> => {
    const { orgId } = await requireRole(ctx, "admin");

    const check = validateUpload(args.filename, args.bytes);
    if (!check.ok)
      throw new ConvexError({ code: "BAD_REQUEST", message: check.reason });
    const category = assertOptionalText(
      args.category,
      INPUT.NAME_MAX,
      "category",
    );

    const entitlements = await ctx.runQuery(
      internal.system.subscriptions.getEntitlements,
      {
        organizationId: orgId,
      },
    );

    // Atomic limit check + reservation (no check-then-act race).
    const slot = await ctx.runMutation(
      internal.system.fileUploads.reserveSlot,
      {
        organizationId: orgId,
        key: check.filename,
        limit: entitlements.limits.knowledgeFiles,
      },
    );
    if (!slot.ok) {
      throw new ConvexError(
        limitError(
          "knowledge-base file",
          slot.used,
          slot.limit,
          entitlements.periodEnd,
        ),
      );
    }

    // Model-based extraction (images, PDFs, HTML) is a metered AI operation.
    const metered = check.kind !== "text";
    const requestId = `ingest:${slot.slotId}`;
    let storageId: Id<"_storage"> | undefined;
    let charged = false;
    let committed = false;

    try {
      if (metered) {
        const usage = await ctx.runMutation(internal.system.usage.consume, {
          organizationId: orgId,
          metric: "aiMessages",
          requestId,
          operationKey: `file-ingestion:${requestId}`,
        });
        if (!usage.allowed) {
          throw new ConvexError(
            limitError("AI message", usage.used, usage.limit, usage.resetsAt),
          );
        }
        charged = true;
      }

      storageId = await ctx.storage.store(
        new Blob([args.bytes], { type: check.mimeType }),
      );

      const text = await extractTextContent(ctx, {
        storageId,
        filename: check.filename,
        bytes: args.bytes,
        mimeType: check.mimeType,
      });

      const ragResult: {
        entryId: EntryId;
        created: boolean;
        oldStorageId: Id<"_storage"> | null;
      } = await ctx.runMutation(internal.private.fileRag.addRagEntry, {
        organizationId: orgId,
        text,
        filename: check.filename,
        category: category ?? null,
        storageId,
        contentHash: await contentHashFromArrayBuffer(args.bytes),
      });

      const { entryId, created, oldStorageId } = ragResult;

      committed = true;

      if (!created) {
        // Duplicate content is already indexed. Blob cleanup is best-effort.
        await ctx.storage.delete(storageId).catch((error) => {
          console.error(
            "ALERT: duplicate upload blob cleanup failed",
            String(error).slice(0, 200),
          );
        });
      } else if (oldStorageId && oldStorageId !== storageId) {
        // Replacing a same-named file must not orphan the previous blob.
        await ctx.storage.delete(oldStorageId).catch((error) => {
          console.error(
            "ALERT: replaced upload blob cleanup failed",
            String(error).slice(0, 200),
          );
        });
      }

      return { entryId };
    } catch (error) {
      if (!committed && storageId) await ctx.storage.delete(storageId).catch(() => {});
      if (!committed && charged) {
        await ctx.runMutation(internal.system.usage.refund, {
          organizationId: orgId,
          requestId,
          operationKey: `file-ingestion:${requestId}`,
        });
      }
      if (error instanceof ConvexError) throw error;
      console.error("ALERT: knowledge file ingestion failed", {
        organizationId: orgId,
        error: String(error).slice(0, 300),
      });
      throw new ConvexError({
        code: "BAD_GATEWAY",
        message: "The file could not be processed. You were not charged.",
      });
    } finally {
      await ctx.runMutation(internal.system.fileUploads.releaseSlot, {
        slotId: slot.slotId,
      });
    }
  },
});

/**
 * Download link for one knowledge file. Ownership is enforced here, at
 * issuance, instead of listing permanent storage URLs to every caller.
 */
export const getDownloadUrl = action({
  args: { entryId: vEntryId },
  handler: async (ctx, args): Promise<string> => {
    const { orgId } = await requireOrg(ctx);

    const storageId = await ctx.runQuery(
      internal.private.fileRag.getOwnedStorageId,
      {
        organizationId: orgId,
        entryId: args.entryId,
      },
    );

    if (!storageId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Not found" });
    }

    const url = await ctx.storage.getUrl(storageId);

    if (!url) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Not found" });
    }

    return url;
  },
});

export const list = query({
  args: {
    category: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx);

    const namespace = await rag.getNamespace(ctx, {
      namespace: orgId,
    });

    if (!namespace) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const results = await rag.list(ctx, {
      namespaceId: namespace.namespaceId,
      paginationOpts: args.paginationOpts,
    });

    const files = await Promise.all(
      results.page.map((entry) => convertEntryToPublicFile(ctx, entry)),
    );

    const filteredFiles = args.category
      ? files.filter((file) => file.category === args.category)
      : files;

    return {
      page: filteredFiles,
      isDone: results.isDone,
      continueCursor: results.continueCursor,
    };
  },
});

export type PublicFile = {
  id: EntryId;
  name: string;
  type: string;
  size: string;
  status: "ready" | "processing" | "error";
  category?: string;
};

type EntryMetadata = {
  storageId: Id<"_storage">;
  uploadedBy: string;
  filename: string;
  category: string | null;
};

async function convertEntryToPublicFile(
  ctx: QueryCtx,
  entry: Entry,
): Promise<PublicFile> {
  const metadata = entry.metadata as EntryMetadata | undefined;
  const storageId = metadata?.storageId;

  let fileSize = "unknown";

  if (storageId) {
    try {
      const storageMetadata = await ctx.db.system.get(storageId);
      if (storageMetadata) {
        fileSize = formatFileSize(storageMetadata.size);
      }
    } catch (error) {
      console.error("Failed to get storage metadata: ", error);
    }
  }

  const filename = entry.key || "Unknown";
  const extension = filename.split(".").pop()?.toLowerCase() || "txt";

  let status: "ready" | "processing" | "error" = "error";
  if (entry.status === "ready") {
    status = "ready";
  } else if (entry.status === "pending") {
    status = "processing";
  }

  return {
    id: entry.entryId,
    name: filename,
    type: extension,
    size: fileSize,
    status,
    category: metadata?.category || undefined,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}
