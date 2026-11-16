import Vapi from "@vapi-ai/web";
import type { VoiceAdapter, VoiceAdapterEvents } from "./types";

/**
 * Vapi adapter. `publicKey` is Vapi's browser-side key (it is designed to be
 * public; restrict its allowed origins in the Vapi dashboard).
 */
export function createVapiAdapter(
  config: { publicKey?: string; assistantId?: string },
  events: VoiceAdapterEvents,
): VoiceAdapter {
  if (!config.publicKey || !config.assistantId) {
    throw new Error("Vapi is not configured.");
  }
  const assistantId = config.assistantId;
  const vapi = new Vapi(config.publicKey);
  let connected = false;

  vapi.on("call-start", () => {
    connected = true;
    events.onStarted();
  });
  vapi.on("call-end", () => {
    connected = false;
    events.onSpeaking(false);
    events.onEnded();
  });
  vapi.on("speech-start", () => events.onSpeaking(true));
  vapi.on("speech-end", () => events.onSpeaking(false));
  vapi.on("error", (error: unknown) => {
    const message = (error as { message?: string } | undefined)?.message ?? "Voice provider error";
    events.onError(message, connected);
  });
  vapi.on("message", (message: { type?: string; transcriptType?: string; role?: string; transcript?: string }) => {
    if (message.type === "transcript" && message.transcriptType === "final" && message.transcript) {
      events.onTranscript(message.role === "user" ? "user" : "assistant", message.transcript);
    }
  });

  return {
    start: async () => {
      await vapi.start(assistantId);
    },
    stop: () => vapi.stop(),
    dispose: () => {
      try {
        vapi.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
