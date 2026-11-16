"use client";

import { api } from "@workspace/backend/_generated/api";
import { useQuery } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { VapiView } from "../views/vapi-view";
import { VoiceTrialView } from "./voice-trial-view";

/** Paid plans get the voice setup page; Free gets the trial explanation (never a blocking pop-up). */
export const VoicePageGate = () => {
  const summary = useQuery(api.private.usage.summary);

  if (summary === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <Loader2Icon className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return summary.limits.voice ? <VapiView /> : <VoiceTrialView />;
};
