import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { RAG } from "@convex-dev/rag";
import { components } from "../../_generated/api";

/**
 * Embedding provider, chosen explicitly (never inferred from which keys exist):
 *
 *   EMBEDDING_PROVIDER=openai (default)  text-embedding-3-small, needs OPENAI_API_KEY (paid)
 *   EMBEDDING_PROVIDER=google            gemini-embedding-001 via the Gemini API free tier,
 *                                        needs GOOGLE_GENERATIVE_AI_API_KEY
 *
 * Both are configured for 1536 dimensions, so the RAG index needs no schema
 * change. Vectors from different models are NOT comparable: after switching,
 * re-upload (re-embed) every knowledge file, otherwise retrieval quality
 * silently degrades. Switch before loading real data.
 */
const provider = (process.env.EMBEDDING_PROVIDER ?? "openai").toLowerCase();

const textEmbeddingModel =
  provider === "google"
    ? google.textEmbeddingModel("gemini-embedding-001", { outputDimensionality: 1536 })
    : openai.embedding("text-embedding-3-small");

const rag = new RAG(components.rag, {
  textEmbeddingModel,
  embeddingDimension: 1536,
});

export default rag;
