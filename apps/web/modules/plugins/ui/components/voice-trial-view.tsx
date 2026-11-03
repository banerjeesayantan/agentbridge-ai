"use client";

import { api } from "@workspace/backend/_generated/api";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { useQuery } from "convex/react";
import { Loader2Icon, MicIcon } from "lucide-react";
import Link from "next/link";

/**
 * What a Free-plan organization sees on the Voice Assistant page.
 * No blocking "Upgrade" pop-up: the Free plan includes a one-time voice demo, so we explain it and
 * point to where it is used. Presentation only; the backend enforces the demo and plan limits.
 */
export const VoiceTrialView = () => {
  const status = useQuery(api.private.voiceDemo.status);

  if (status === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <Loader2Icon className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const message = !status.demoEnabled
    ? "The free voice demo is not available right now. You can upgrade to use voice with your own assistant."
    : status.trialUsed
      ? "Your free voice trial has been used. Upgrade your plan to keep using voice."
      : "Your Free plan includes one demo voice call. Open the Playground, then use the voice button in the chat widget to try it.";

  return (
    <div className="flex min-h-screen flex-col bg-muted p-8">
      <div className="mx-auto w-full max-w-screen-md">
        <div className="space-y-2">
          <h1 className="text-2xl md:text-4xl">Voice Assistant</h1>
          <p className="text-muted-foreground">Let customers talk to your AI by voice.</p>
        </div>
        <Card className="mt-8">
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <MicIcon className="size-5 text-primary" />
            </div>
            <CardTitle>Free voice trial</CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {status.demoEnabled && !status.trialUsed && (
              <Button asChild>
                <Link href="/">Try it in the Playground</Link>
              </Button>
            )}
            <Button asChild variant={status.demoEnabled && !status.trialUsed ? "outline" : "default"}>
              <Link href="/billing">View plans</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
