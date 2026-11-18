"use client";

import { useEffect, useState } from "react";
import { LoaderIcon } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { contactSessionIdAtomFamily, errorMessageAtom, installTokenAtom, loadingMessageAtom, organizationIdAtom, screenAtom, widgetSettingsAtom } from "@/modules/widget/atoms/widget-atoms";
import { WidgetHeader } from "@/modules/widget/ui/components/widget-header";
import { useAction, useMutation } from "convex/react";
import { api } from "@workspace/backend/_generated/api";

type InitStep = "session" | "settings" | "done";

export const WidgetLoadingScreen = ({ organizationId, installToken }: { organizationId: string | null; installToken: string | null }) => {
  const [step, setStep] = useState<InitStep>("session");
  const [sessionValid, setSessionValid] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const contactSessionId = useAtomValue(contactSessionIdAtomFamily(organizationId || ""));
  const setInstallToken = useSetAtom(installTokenAtom);
  const setWidgetSettings = useSetAtom(widgetSettingsAtom);
  const setOrganizationId = useSetAtom(organizationIdAtom);
  const setLoadingMessage = useSetAtom(loadingMessageAtom);
  const setErrorMessage = useSetAtom(errorMessageAtom);
  const setScreen = useSetAtom(screenAtom);

  const validateContactSession = useMutation(api.public.contactSessions.validate);
  const loadWidgetSettings = useAction(api.public.widgetSettings.getByOrganizationId);

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
    if (step !== "settings" || !organizationId || !installToken || settingsLoaded) return;
    let cancelled = false;
    setLoadingMessage("Loading secure widget settings...");
    void loadWidgetSettings({ organizationId, installToken })
      .then((settings) => {
        if (cancelled) return;
        setWidgetSettings(settings);
        setSettingsLoaded(true);
        setStep("done");
      })
      .catch(() => {
        if (cancelled) return;
        setErrorMessage("This website is not authorized to use this widget. Check the allowed website origins in Widget Customization.");
        setScreen("error");
      });
    return () => { cancelled = true; };
  }, [step, organizationId, installToken, settingsLoaded, loadWidgetSettings, setWidgetSettings, setLoadingMessage, setErrorMessage, setScreen]);

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
