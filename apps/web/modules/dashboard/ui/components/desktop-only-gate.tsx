"use client";

import { useEffect, useState } from "react";
import { MonitorIcon } from "lucide-react";

type DeviceState = "checking" | "desktop" | "mobile";

const isMobileDevice = () => {
  const userAgent = navigator.userAgent;
  const isTouchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;

  return (
    /Android|iPhone|iPad|iPod|IEMobile|Windows Phone|webOS|BlackBerry|Opera Mini/i.test(userAgent) ||
    isTouchMac
  );
};

export const DesktopOnlyGate = ({ children }: { children: React.ReactNode }) => {
  const [device, setDevice] = useState<DeviceState>("checking");

  useEffect(() => {
    setDevice(isMobileDevice() ? "mobile" : "desktop");
  }, []);

  if (device === "checking") {
    return <div className="grid min-h-svh place-items-center bg-background p-6 text-sm text-muted-foreground">Checking device…</div>;
  }

  if (device === "mobile") {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-6">
        <section className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center shadow-sm">
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <MonitorIcon aria-hidden className="size-7 text-foreground" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Open AgentBridge on a PC or laptop</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            AgentBridge is designed for desktop and laptop screens. Please switch to a PC or laptop to access your workspace.
          </p>
        </section>
      </main>
    );
  }

  return children;
};
