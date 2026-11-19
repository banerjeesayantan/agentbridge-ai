import { createTool } from "@convex-dev/agent";
import z from "zod";
import { internal } from "../../../_generated/api";
import rag from "../rag";

const MAX_KNOWLEDGE_CONTEXT_CHARS = 12_000;

export const search = createTool({
  description: "Search the knowledge base for relevant information to help answer user questions",
  args: z.object({
    query: z
      .string()
      .describe("The search query to find relevant information")
  }),
  handler: async (ctx, args) => {
    if (!ctx.threadId) {
      return "Missing thread ID";
    }

    const conversation = await ctx.runQuery(
      internal.system.conversations.getByThreadId,
      { threadId: ctx.threadId },
    );

    if (!conversation) {
      return "Conversation not found";
    }

    const searchResult = await rag.search(ctx, {
      namespace: conversation.organizationId,
      query: args.query,
      limit: 5,
    });

    if (!searchResult.text.trim()) {
      return "No relevant information was found in the knowledge base.";
    }

    // Return retrieved evidence directly to the parent agent. Running a
    // second LLM call here to rewrite the search results adds another full
    // model round-trip before the parent agent can finish its answer.
    return searchResult.text.slice(0, MAX_KNOWLEDGE_CONTEXT_CHARS);
  },
});
