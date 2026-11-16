import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { components } from "../_generated/api";
import { getEntitlements } from "../lib/entitlements";


export const getForConversation = query({
  args: {
    conversationId: v.id("conversations"),
    contactSessionId: v.id("contactSessions"),
  },

  handler: async (ctx, args) => {
    const now = Date.now();

    const contactSession = await ctx.db.get(args.contactSessionId);

    if (!contactSession || contactSession.expiresAt < now) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid or expired session.",
      });
    }

    const conversation = await ctx.db.get(args.conversationId);

    if (
      !conversation ||
      conversation.contactSessionId !== contactSession._id ||
      conversation.organizationId !== contactSession.organizationId
    ) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Conversation does not belong to this session.",
      });
    }

    const records = await ctx.db
      .query("feedback")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversation._id),
      )
      .collect();

    return records.map((record) => ({
      messageId: record.messageId,
      rating: record.rating,
    }));
  },
});

export const submit = mutation({
  args: {
    conversationId: v.id("conversations"),
    contactSessionId: v.id("contactSessions"),
    messageId: v.string(),
    rating: v.union(v.literal("positive"), v.literal("negative")),
    comment: v.optional(v.string()),
  },

  handler: async (ctx, args) => {
    const now = Date.now();

    // Validate the visitor session.
    const contactSession = await ctx.db.get(args.contactSessionId);

    if (!contactSession || contactSession.expiresAt < now) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid or expired session.",
      });
    }

    // Verify that this conversation belongs to this visitor.
    const conversation = await ctx.db.get(args.conversationId);

    if (
      !conversation ||
      conversation.contactSessionId !== contactSession._id ||
      conversation.organizationId !== contactSession.organizationId
    ) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Conversation does not belong to this session.",
      });
    }

    // Verify that the submitted message is a successful assistant
    // message in this exact conversation thread.
    const [message] = await ctx.runQuery(
      components.agent.messages.getMessagesByIds,
      {
        messageIds: [args.messageId],
      },
    );

    if (
      !message ||
      message.threadId !== conversation.threadId ||
      message.status !== "success" ||
      message.message?.role !== "assistant" ||
      message.tool
    ) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Feedback can only be submitted for a completed assistant message.",
      });
    }

    // Resolve plan from the conversation's trusted organization ID.
    const entitlements = await getEntitlements(
      ctx,
      conversation.organizationId,
    );

    const comment = args.comment?.trim();

    if (comment && comment.length > 2000) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Feedback comments cannot exceed 2,000 characters.",
      });
    }

    if (comment && entitlements.plan === "free") {
      throw new ConvexError({
        code: "PLAN_REQUIRED",
        message: "Written feedback is available on Pro and Enterprise plans.",
      });
    }

    // One rating per organization and assistant message.
    // Re-submission edits the existing rating.
    const existing = await ctx.db
      .query("feedback")
      .withIndex("by_organization_and_message", (q) =>
        q
          .eq("organizationId", conversation.organizationId)
          .eq("messageId", args.messageId),
      )
      .unique();

    const feedbackData = {
      rating: args.rating,
      ...(comment !== undefined ? { comment } : {}),
      updatedAt: now,
    };

    if (existing) {
      // Also verify the existing record belongs to this conversation.
      if (existing.conversationId !== conversation._id) {
        throw new ConvexError({
          code: "UNAUTHORIZED",
          message: "Feedback message ownership could not be verified.",
        });
      }

      await ctx.db.patch(existing._id, feedbackData);

      return { success: true, feedbackId: existing._id, updated: true };
    }

    const feedbackId = await ctx.db.insert("feedback", {
      organizationId: conversation.organizationId,
      conversationId: conversation._id,
      threadId: conversation.threadId,
      messageId: args.messageId,
      ...feedbackData,
      createdAt: now,
    });

    return { success: true, feedbackId, updated: false };
  },
});
