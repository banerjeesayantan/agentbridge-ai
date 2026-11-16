/**
 * Messages from the widget iframe to the embed script on the host page.
 * They carry no secrets (only UI intents), so the target origin is "*": the
 * embedding page's origin is not known to the widget. The embed script
 * verifies the sender window and origin before acting (apps/embed/embed.ts).
 */
export type EmbedMessage = { type: "close" } | { type: "resize"; payload: { height: number } };

export const isEmbedded = (): boolean => typeof window !== "undefined" && window.parent !== window;

export function postToParent(message: EmbedMessage): void {
  if (isEmbedded()) window.parent.postMessage(message, "*");
}
