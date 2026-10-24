import { ConvexError, v } from "convex/values";
import { action, query } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { supportAgent } from "../system/ai/agents/supportAgent";
import { paginationOptsValidator } from "convex/server";
import { escalateConversation } from "../system/ai/tools/escalateConversation";
import { resolveConversation } from "../system/ai/tools/resolveConversation";
import { saveMessage } from "@convex-dev/agent";
import { search } from "../system/ai/tools/search";

export const create = action({
  args: {
    prompt: v.string(),
    threadId: v.string(),
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args) => {
    const contactSession = await ctx.runQuery(
      internal.system.contactSessions.getOne,
      {
        contactSessionId: args.contactSessionId,
      }
    );

    if (!contactSession || contactSession.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid session",
      });
    }

    const conversation = await ctx.runQuery(
      internal.system.conversations.getByThreadId,
      {
        threadId: args.threadId,
      },
    );

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    if (conversation.contactSessionId !== contactSession._id) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Conversation does not belong to this session",
      });
    }

    if (conversation.status === "resolved") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Conversation resolved",
      });
    }

    // This refreshes the user's session if they are within the threshold
    await ctx.runMutation(internal.system.contactSessions.refresh, {
      contactSessionId: args.contactSessionId,
    });

    // Always store the visitor's message first so nothing is lost if the AI is
    // unavailable or the plan's allowance is used up.
    if (conversation.status !== "unresolved") {
      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        prompt: args.prompt,
      });
      return;
    }

    if (!process.env.GROQ_API_KEY) {
      await saveMessage(ctx, components.agent, { threadId: args.threadId, prompt: args.prompt });
      await ctx.runMutation(internal.system.conversations.escalate, { threadId: args.threadId });
      throw new ConvexError({
        code: "SERVICE_UNAVAILABLE",
        message: "The AI assistant is not configured. Your message was saved and a team member will reply.",
      });
    }

    const usage = await ctx.runMutation(internal.system.usage.consume, {
      organizationId: conversation.organizationId,
      metric: "aiMessages",
    });

    if (!usage.allowed) {
      // Over the plan's allowance: keep the message and hand over to a human
      // instead of calling the model or dropping the customer.
      await saveMessage(ctx, components.agent, { threadId: args.threadId, prompt: args.prompt });
      await ctx.runMutation(internal.system.conversations.escalate, { threadId: args.threadId });
      return;
    }

    await supportAgent.generateText(
      ctx,
      { threadId: args.threadId },
      {
        prompt: args.prompt,
        tools: {
          escalateConversationTool: escalateConversation,
          resolveConversationTool: resolveConversation,
          searchTool: search,
        },
      },
    );
  },
});

export const getMany = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args) => {
    const contactSession = await ctx.db.get(args.contactSessionId);

    if (!contactSession || contactSession.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid session",
      });
    }

    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!conversation || conversation.contactSessionId !== contactSession._id) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Conversation does not belong to this session",
      });
    }

    const paginated = await supportAgent.listMessages(ctx, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });

    return paginated;
  },
});
