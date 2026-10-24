import rag from "../system/ai/rag";

type RagCtx = Parameters<typeof rag.list>[0];

/** Count an organization's knowledge files, stopping at `cap` (enough to test a limit). */
export async function countKnowledgeFiles(ctx: RagCtx, organizationId: string, cap: number): Promise<number> {
  const namespace = await rag.getNamespace(ctx, { namespace: organizationId });
  if (!namespace) return 0;
  const result = await rag.list(ctx, {
    namespaceId: namespace.namespaceId,
    paginationOpts: { numItems: cap, cursor: null },
  });
  return result.page.length;
}
