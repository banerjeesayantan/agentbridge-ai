import { ArrowLeftIcon, MicIcon, MicOffIcon } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
  AIConversation,
  AIConversationContent,
  AIConversationScrollButton,
} from "@workspace/ui/components/ai/conversation";
import {
  AIMessage,
  AIMessageContent,
} from "@workspace/ui/components/ai/message";
import { useVapi } from "@/modules/widget/hooks/use-vapi";
import { WidgetHeader } from "@/modules/widget/ui/components/widget-header";
import { useSetAtom } from "jotai";
import { screenAtom } from "../../atoms/widget-atoms";
import { cn } from "@workspace/ui/lib/utils";

export const WidgetVoiceScreen = () => {
  const setScreen = useSetAtom(screenAtom);

  const {
    isConnected,
    isSpeaking,
    transcript,
    startCall,
    endCall,
    isConnecting,
    showPaywall,
    closePaywall,
  } = useVapi();

  return (
    <>
      <WidgetHeader>
        <div className="flex items-center gap-x-2">
          <Button
            variant="transparent"
            size="icon"
            onClick={() => setScreen("selection")}
          >
            <ArrowLeftIcon />
          </Button>

          <p>Voice Chat</p>
        </div>
      </WidgetHeader>

      {transcript.length > 0 ? (
        <AIConversation className="h-full">
          <AIConversationContent>
            {transcript.map((message, index) => (
              <AIMessage
                from={message.role}
                key={`${message.role}-${index}-${message.text}`}
              >
                <AIMessageContent>{message.text}</AIMessageContent>
              </AIMessage>
            ))}
          </AIConversationContent>

          <AIConversationScrollButton />
        </AIConversation>
      ) : (
        <div className="flex h-full flex-1 flex-col items-center justify-center gap-y-4">
          <div className="flex items-center justify-center rounded-full border bg-white p-3">
            <MicIcon className="size-6 text-muted-foreground" />
          </div>

          <p className="text-muted-foreground">Transcript will appear here</p>
        </div>
      )}

      <div className="border-t bg-background p-4">
        <div className="flex flex-col items-center gap-y-4">
          {isConnected && (
            <div className="flex items-center gap-x-2">
              <div
                className={cn(
                  "size-4 rounded-full",
                  isSpeaking ? "animate-pulse bg-red-500" : "bg-green-500",
                )}
              />

              <span className="text-muted-foreground text-sm">
                {isSpeaking ? "Assistant Speaking..." : "Listening..."}
              </span>
            </div>
          )}

          <div className="flex w-full justify-center">
            {isConnected ? (
              <Button
                className="w-full"
                size="lg"
                variant="destructive"
                onClick={() => endCall()}
              >
                <MicOffIcon />
                End call
              </Button>
            ) : (
              <Button
                className="w-full"
                disabled={isConnecting}
                size="lg"
                onClick={() => startCall()}
              >
                <MicIcon />
                {isConnecting ? "Checking access..." : "Start call"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {showPaywall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-xl">
            <div className="flex flex-col gap-y-4">
              <div>
                <h2 className="text-lg font-semibold">Voice trial used</h2>

                <p className="mt-2 text-sm text-muted-foreground">
                  Your free voice trial has already been used. Upgrade to a paid
                  plan to continue using voice chat.
                </p>
              </div>

              <div className="flex gap-x-2">
                <Button
                  className="flex-1"
                  variant="outline"
                  onClick={closePaywall}
                >
                  Close
                </Button>

                <Button
                  className="flex-1"
                  onClick={() => {
                    window.open(
                      "http://localhost:3000/billing",
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                >
                  Upgrade
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
