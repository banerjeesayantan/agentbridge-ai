/**
 * Provider-agnostic voice interface. The widget talks only to this; each vendor
 * lives behind an adapter. Adapters receive PUBLIC client configuration only
 * (e.g. a public key). Private provider keys never reach the browser.
 */
export interface VoiceAdapterEvents {
  onStarted: (providerCallId?: string) => void;
  onEnded: () => void;
  onSpeaking: (speaking: boolean) => void;
  onTranscript: (role: "user" | "assistant", text: string) => void;
  /** `connected` tells the hook whether the call had begun (no mid-call provider switching). */
  onError: (message: string, connected: boolean) => void;
}

export interface VoiceAdapter {
  start: () => Promise<void>;
  stop: () => void;
  dispose: () => void;
}

export type VoiceProviderId = "vapi";

export type VoiceAdapterFactory = (publicConfig: Record<string, string>, events: VoiceAdapterEvents) => VoiceAdapter;
