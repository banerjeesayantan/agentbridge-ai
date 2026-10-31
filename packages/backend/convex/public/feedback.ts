import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";

const MAX_COMMENT = 500;

async function loadOwnedConversation(
  ctx: { db: any },
  contactSessionId: any,
  conversationId: any,
) {
  const session = await ctx.db.get(contactSessionId);
  if (!session || session.expiresAt < Date.now()) {
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Invalid session" });
  }
  const conversation = await ctx.db.get(conversationId);
  if (!conversation || conversation.contactSessionId !== session._id) {
    throw new ConvexError({ code: "UNAUTHORIZED", message: "Conversation does not belong to this session" });
  }
  return conversation;
}

/** A customer rates one AI answer. One rating per message; re-rating replaces it. */
export const submit = mutation({
  args: {
    contactSessionId: v.id("contactSessions"),
    conversationId: v.id("conversations"),
    messageId: v.string(),
    rating: v.union(v.literal("positive"), v.literal("negative")),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const conversation = await loadOwnedConversation(ctx, args.contactSessionId, args.conversationId);

    if (!args.messageId || args.messageId.length > 200) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Invalid message" });
    }
    const comment = args.comment?.trim().slice(0, MAX_COMMENT) || undefined;

    const existing = await ctx.db
      .query("feedback")
      .withIndex("by_conversation_and_message", (q) =>
        q.eq("conversationId", args.conversationId).eq("messageId", args.messageId),
      )
      .unique();

    const fields = { rating: args.rating, comment, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("feedback", {
        organizationId: conversation.organizationId,
        conversationId: conversation._id,
        threadId: conversation.threadId,
        messageId: args.messageId,
        ...fields,
      });
    }
  },
});

/** Ratings the caller has already given in this conversation (to show state). */
export const getForConversation = query({
  args: {
    contactSessionId: v.id("contactSessions"),
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    await loadOwnedConversation(ctx, args.contactSessionId, args.conversationId);
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_conversation_and_message", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    return rows.map((r) => ({ messageId: r.messageId, rating: r.rating }));
  },
});
