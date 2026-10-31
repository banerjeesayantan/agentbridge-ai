import type { VoiceAdapterFactory, VoiceProviderId } from "./types";
import { createVapiAdapter } from "./vapi-adapter";

/** Add a provider here only after its adapter, free-tier terms and compatibility are verified. */
const registry: Record<VoiceProviderId, VoiceAdapterFactory> = {
  vapi: (config, events) => createVapiAdapter(config, events),
};

export function createAdapter(provider: string, ...args: Parameters<VoiceAdapterFactory>) {
  const factory = (registry as Record<string, VoiceAdapterFactory | undefined>)[provider];
  if (!factory) throw new Error(`Unsupported voice provider: ${provider}`);
  return factory(...args);
}
