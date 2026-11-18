"use client";

import { useEffect, useState } from "react";
import { LoaderIcon } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { contactSessionIdAtomFamily, errorMessageAtom, installTokenAtom, loadingMessageAtom, organizationIdAtom, screenAtom, widgetSettingsAtom } from "@/modules/widget/atoms/widget-atoms";
import { WidgetHeader } from "@/modules/widget/ui/components/widget-header";
import { useMutation, useQuery } from "convex/react";
import { api } from "@workspace/backend/_generated/api";

type InitStep = "session" | "settings" | "done";

export const WidgetLoadingScreen = ({ organizationId, installToken }: { organizationId: string | null; installToken: string | null }) => {
  const [step, setStep] = useState<InitStep>("session");
  const [sessionValid, setSessionValid] = useState(false);
  const contactSessionId = useAtomValue(contactSessionIdAtomFamily(organizationId || ""));
  const setInstallToken = useSetAtom(installTokenAtom);
  const setWidgetSettings = useSetAtom(widgetSettingsAtom);
  const setOrganizationId = useSetAtom(organizationIdAtom);
  const setLoadingMessage = useSetAtom(loadingMessageAtom);
  const setErrorMessage = useSetAtom(errorMessageAtom);
  const setScreen = useSetAtom(screenAtom);

  const validateContactSession = useMutation(api.public.contactSessions.validate);
  const widgetSettings = useQuery(
    api.public.widgetSettings.getByOrganizationId,
    organizationId && installToken ? { organizationId, installToken } : "skip",
  );

  useEffect(() => {
    if (!organizationId) {
      setErrorMessage("Widget organization ID is missing.");
      setScreen("error");
      return;
    }
    setOrganizationId(organizationId);
  }, [organizationId, setOrganizationId, setErrorMessage, setScreen]);

  useEffect(() => {
    if (!installToken) return;
    setInstallToken(installToken);
  }, [installToken, setInstallToken]);

  useEffect(() => {
    if (step !== "session" || !organizationId || !installToken) return;
    let cancelled = false;
    setLoadingMessage("Verifying website authorization...");
    const validate = async () => {
      if (!contactSessionId) {
        if (!cancelled) { setSessionValid(false); setStep("settings"); }
        return;
      }
      try {
        const result = await validateContactSession({ contactSessionId, installToken });
        if (!cancelled) { setSessionValid(result.valid); setStep("settings"); }
      } catch {
        if (!cancelled) { setSessionValid(false); setStep("settings"); }
      }
    };
    void validate();
    return () => { cancelled = true; };
  }, [step, organizationId, installToken, contactSessionId, validateContactSession, setLoadingMessage]);

  useEffect(() => {
    if (step !== "settings" || !installToken) return;
    if (widgetSettings === undefined) {
      setLoadingMessage("Loading secure widget settings...");
      return;
    }
    setWidgetSettings(widgetSettings);
    setStep("done");
  }, [step, installToken, widgetSettings, setWidgetSettings, setLoadingMessage]);

  useEffect(() => {
    if (step === "done") setScreen(contactSessionId && sessionValid ? "selection" : "auth");
  }, [step, contactSessionId, sessionValid, setScreen]);

  return (
    <>
      <WidgetHeader>
        <div className="flex flex-col justify-between gap-y-2 px-2 py-6 font-semibold">
          <p className="text-3xl">Hi there! 👋</p>
          <p className="text-lg">Let&apos;s get you started</p>
        </div>
      </WidgetHeader>
      <div className="flex flex-1 flex-col items-center justify-center gap-y-4 p-4 text-muted-foreground">
        <LoaderIcon className="animate-spin" />
        <p className="text-sm">{!installToken ? "Waiting for secure installation authorization..." : "Verifying widget installation..."}</p>
      </div>
    </>
  );
};
