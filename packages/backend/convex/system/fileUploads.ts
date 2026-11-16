import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { countKnowledgeFiles } from "../lib/knowledgeFiles";

/** A reservation older than this is abandoned (the action crashed) and ignored. */
export const SLOT_TTL_MS = 15 * 60 * 1000;

/**
 * Atomically reserve one knowledge-file slot. Existing files and in-flight
 * uploads both count, and the check + insert happen in ONE transaction, so
 * concurrent uploads cannot jointly exceed the plan's limit.
 */
export const reserveSlot = internalMutation({
  args: { organizationId: v.string(), key: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await countKnowledgeFiles(ctx, args.organizationId, args.limit);
    const inFlight = await ctx.db
      .query("fileUploads")
      .withIndex("by_organization_id_and_created_at", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .gt("createdAt", now - SLOT_TTL_MS),
      )
      .take(args.limit + 1);

    const used = existing + inFlight.length;
    if (used >= args.limit) return { ok: false as const, used, limit: args.limit };

    const slotId = await ctx.db.insert("fileUploads", { organizationId: args.organizationId, key: args.key, createdAt: now });
    return { ok: true as const, slotId };
  },
});

export const releaseSlot = internalMutation({
  args: { slotId: v.id("fileUploads") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.slotId);
    if (row) await ctx.db.delete(row._id);
  },
});

