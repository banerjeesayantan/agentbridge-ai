import { useAction } from "convex/react";
import { api } from "@workspace/backend/_generated/api";
import type { Id } from "@workspace/backend/_generated/dataModel";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { contactSessionIdAtomFamily, organizationIdAtom, vapiSecretsAtom, widgetSettingsAtom } from "../atoms/widget-atoms";
import { createAdapter } from "../voice/registry";
import type { VoiceAdapter } from "../voice/types";

interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
}

export type VoiceAccess = "loading" | "plan" | "demo" | "trial_used" | "attempts_exceeded" | "unavailable";

const messageOf = (error: unknown, fallback: string) => {
  const data = (error as { data?: { message?: string } | string } | undefined)?.data;
  if (data && typeof data === "object" && data.message) return data.message;
  return fallback;
};

/**
 * Voice call hook.
 *  - Organizations whose plan includes voice use their own configured Vapi assistant (unchanged).
 *  - Free organizations get ONE server-authorized demo call. The server reserves
 *    quota before the call, picks the provider, and decides afterwards whether the
 *    trial was used. The browser only ever holds the provider's public client key.
 */
export const useVapi = () => {
  const vapiSecrets = useAtomValue(vapiSecretsAtom);
  const widgetSettings = useAtomValue(widgetSettingsAtom);
  const organizationId = useAtomValue(organizationIdAtom);
  const contactSessionId = useAtomValue(contactSessionIdAtomFamily(organizationId || ""));

  const getEligibility = useAction(api.public.voiceDemo.getEligibility);
  const startDemo = useAction(api.public.voiceDemo.start);
  const switchProvider = useAction(api.public.voiceDemo.switchProvider);
  const markStarted = useAction(api.public.voiceDemo.markStarted);
  const finishDemo = useAction(api.public.voiceDemo.finish);

  const [access, setAccess] = useState<VoiceAccess>("loading");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const adapter = useRef<VoiceAdapter | null>(null);
  const demo = useRef<{ sessionId: Id<"voiceSessions">; startedAt: number | null; userTurns: number; finished: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);

  // What is this visitor allowed to do?
  useEffect(() => {
    if (!contactSessionId) return;
    let cancelled = false;
    getEligibility({ contactSessionId })
      .then(({ state }) => {
        if (cancelled) return;
        if (state === "paid") setAccess("plan");
        else if (state === "available") setAccess("demo");
        else if (state === "trial_used" || state === "attempts_exceeded") setAccess(state);
        else setAccess("unavailable");
      })
      .catch(() => !cancelled && setAccess("unavailable"));
    return () => {
      cancelled = true;
    };
  }, [contactSessionId, getEligibility]);

  const teardown = useCallback(() => {
    if (demo.current?.timer) clearTimeout(demo.current.timer);
    adapter.current?.dispose();
    adapter.current = null;
  }, []);

  const closeDemo = useCallback(
    async (providerError?: string) => {
      const d = demo.current;
      if (!d || d.finished || !contactSessionId) return;
      d.finished = true;
      const seconds = d.startedAt ? (Date.now() - d.startedAt) / 1000 : 0;
      teardown();
      try {
        const result = await finishDemo({ sessionId: d.sessionId, contactSessionId, clientDurationSeconds: seconds, userTurns: d.userTurns, error: providerError });
        if (result.trialConsumed) setAccess("trial_used");
      } catch {
        /* the server settles abandoned sessions on its own */
      }
    },
    [contactSessionId, finishDemo, teardown],
  );

  // Best effort: if the widget unmounts mid-call, report it. The server cron settles it otherwise.
  const closeRef = useRef(closeDemo);
  closeRef.current = closeDemo;
  useEffect(
    () => () => {
      void closeRef.current();
    },
    [],
  );

  const attach = useCallback(
    async (provider: string, publicConfig: Record<string, string>, sessionId: Id<"voiceSessions">, maxSeconds: number, fallbackBudget: number): Promise<void> => {
      if (!contactSessionId) return;
      let connected = false;
      const fail = async (message: string) => {
        teardown();
        if (connected) {
          // No provider switching mid-call.
          setIsConnected(false);
          setIsSpeaking(false);
          setError("The call was interrupted.");
          await closeDemo(message);
          return;
        }
        if (fallbackBudget > 0) {
          try {
            const next = await switchProvider({ sessionId, contactSessionId, error: message });
            await attach(next.provider, next.publicConfig, next.sessionId, next.maxSeconds, fallbackBudget - 1);
            return;
          } catch (e) {
            setError(messageOf(e, "The voice demo is temporarily unavailable."));
          }
        } else {
          setError("The voice demo is temporarily unavailable.");
          await closeDemo(message);
        }
        setIsConnecting(false);
      };

      try {
        adapter.current = createAdapter(provider, publicConfig, {
          onStarted: (providerCallId) => {
            connected = true;
            if (demo.current) demo.current.startedAt = Date.now();
            setIsConnected(true);
            setIsConnecting(false);
            setTranscript([]);
            void markStarted({ sessionId, contactSessionId, providerCallId }).catch(() => {
              void closeDemo("start-not-recorded");
            });
            demo.current!.timer = setTimeout(() => adapter.current?.stop(), maxSeconds * 1000);
          },
          onEnded: () => {
            setIsConnected(false);
            setIsConnecting(false);
            setIsSpeaking(false);
            void closeDemo();
          },
          onSpeaking: setIsSpeaking,
          onTranscript: (role, text) => {
            if (role === "user" && demo.current) demo.current.userTurns += 1;
            setTranscript((prev) => [...prev, { role, text }]);
          },
          onError: (message, wasConnected) => {
            connected = connected || wasConnected;
            void fail(message);
          },
        });
        await adapter.current.start();
      } catch (e) {
        await fail(e instanceof Error ? e.message : "Could not start the call");
      }
    },
    [closeDemo, contactSessionId, markStarted, switchProvider, teardown],
  );

  const startCall = async () => {
    setError(null);

    if (access === "plan") {
      // Existing behavior: the organization's own Vapi assistant.
      const assistantId = widgetSettings?.vapiSettings?.assistantId;
      if (!vapiSecrets || !assistantId) return;
      setIsConnecting(true);
      demo.current = null;
      try {
        adapter.current = createAdapter(
          "vapi",
          { publicKey: vapiSecrets.publicApiKey, assistantId },
          {
            onStarted: () => {
              setIsConnected(true);
              setIsConnecting(false);
              setTranscript([]);
            },
            onEnded: () => {
              setIsConnected(false);
              setIsConnecting(false);
              setIsSpeaking(false);
            },
            onSpeaking: setIsSpeaking,
            onTranscript: (role, text) => setTranscript((prev) => [...prev, { role, text }]),
            onError: () => setIsConnecting(false),
          },
        );
        await adapter.current.start();
      } catch {
        setIsConnecting(false);
        setError("Could not start the call.");
      }
      return;
    }

    if (access !== "demo" || !contactSessionId) return;
    setIsConnecting(true);
    try {
      const reservation = await startDemo({ contactSessionId });
      demo.current = { sessionId: reservation.sessionId, startedAt: null, userTurns: 0, finished: false };
      await attach(reservation.provider, reservation.publicConfig, reservation.sessionId, reservation.maxSeconds, 2);
    } catch (e) {
      setIsConnecting(false);
      setError(messageOf(e, "The voice demo is not available right now."));
    }
  };

  const endCall = () => {
    adapter.current?.stop();
  };

  return { access, error, isSpeaking, isConnecting, isConnected, transcript, startCall, endCall };
};
