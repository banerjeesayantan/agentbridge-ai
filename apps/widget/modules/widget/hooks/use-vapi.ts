
import Vapi from "@vapi-ai/web";
import { useAction } from "convex/react";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { api } from "@workspace/backend/_generated/api";
import {
  contactSessionIdAtomFamily,
  organizationIdAtom,
  vapiSecretsAtom,
  widgetSettingsAtom,
} from "../atoms/widget-atoms";

interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
}

export const useVapi = () => {
  const vapiSecrets = useAtomValue(vapiSecretsAtom);
  const widgetSettings = useAtomValue(widgetSettingsAtom);
  const organizationId = useAtomValue(organizationIdAtom);
  const contactSessionId = useAtomValue(
    contactSessionIdAtomFamily(organizationId ?? "")
  );

  const authorizeVoice = useAction(api.public.voiceTrials.authorize);

  const [vapi, setVapi] = useState<Vapi | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);

  useEffect(() => {
    if (!vapiSecrets) return;

    const vapiInstance = new Vapi(vapiSecrets.publicApiKey);
    setVapi(vapiInstance);

    vapiInstance.on("call-start", () => {
      setIsConnected(true);
      setIsConnecting(false);
      setTranscript([]);
    });

    vapiInstance.on("call-end", () => {
      setIsConnected(false);
      setIsConnecting(false);
      setIsSpeaking(false);
    });

    vapiInstance.on("speech-start", () => setIsSpeaking(true));
    vapiInstance.on("speech-end", () => setIsSpeaking(false));

    vapiInstance.on("error", (error) => {
      console.error(error, "VAPI_ERROR");
      setIsConnecting(false);
    });

    vapiInstance.on("message", (message) => {
      if (
        message.type === "transcript" &&
        message.transcriptType === "final"
      ) {
        setTranscript((prev) => [
          ...prev,
          {
            role: message.role === "user" ? "user" : "assistant",
            text: message.transcript,
          },
        ]);
      }
    });

    return () => {
      vapiInstance.stop();
    };
  }, [vapiSecrets]);

  const startCall = async () => {
    const assistantId = widgetSettings?.vapiSettings?.assistantId;

    if (
      !vapi ||
      !vapiSecrets ||
      !assistantId ||
      !organizationId ||
      !contactSessionId ||
      isConnecting ||
      isConnected
    ) {
      return;
    }

    setIsConnecting(true);

    try {
      const result = await authorizeVoice({
        organizationId,
        contactSessionId,
      });

      if (!result.allowed) {
        setShowPaywall(true);
        setIsConnecting(false);
        return;
      }

      await vapi.start(assistantId);
    } catch (error) {
      console.error(error, "VOICE_AUTHORIZATION_ERROR");
      setIsConnecting(false);
    }
  };

  const endCall = () => {
    vapi?.stop();
  };

  const closePaywall = () => {
    setShowPaywall(false);
  };

  return {
    isSpeaking,
    isConnecting,
    isConnected,
    transcript,
    startCall,
    endCall,
    showPaywall,
    closePaywall,
  };
};
