import { groq } from "@ai-sdk/groq";

/**
 * Groq retired llama-3.3-70b-versatile on 2026-08-16 and the llama-3.2 vision
 * previews on 2025-04-14 (https://console.groq.com/docs/deprecations).
 * Defaults follow Groq's own recommended replacements; override per
 * deployment with Convex env vars so the next retirement needs no code change:
 *
 *   GROQ_CHAT_MODEL    text + tool calling  (default openai/gpt-oss-120b)
 *   GROQ_VISION_MODEL  image understanding (default qwen/qwen3.8-27b)
 *
 * The vision default is the model Groq's page names as multimodal but does
 * not list as a confirmed production vision model: verify it in the Groq
 * console and set GROQ_VISION_MODEL if needed. Image uploads are the only
 * feature that depends on it.
 */
export const CHAT_MODEL_ID = process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b";
export const VISION_MODEL_ID = process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";

export const chatModel = () => groq(CHAT_MODEL_ID);
export const visionModel = () => groq(VISION_MODEL_ID);
