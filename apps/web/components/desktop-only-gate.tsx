"use client";

import { useEffect, type ReactNode } from "react";

const MOBILE_DEVICE_PATTERN =
  /Android.*Mobile|iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini/i;

export function DesktopOnlyGate({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => {
      const isPhone = MOBILE_DEVICE_PATTERN.test(navigator.userAgent);
      root.classList.toggle("is-mobile-device", isPhone || media.matches);
    };

    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
      root.classList.remove("is-mobile-device");
    };
  }, []);

  return (
    <>
      <div className="desktop-app-content">{children}</div>
      <main className="mobile-access-notice" role="status" aria-labelledby="mobile-access-title">
        <section className="mobile-access-card">
          <div className="mobile-access-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M8 21h8M12 17v4M7 9h10M7 12h6" />
            </svg>
          </div>
          <p className="mobile-access-brand">AgentBridge AI</p>
          <h1 id="mobile-access-title">Please open AgentBridge on a PC</h1>
          <p>
            AgentBridge is designed for laptop, desktop, and tablet screens.
            Please open this workspace on a PC or tablet for the full
            experience.
          </p>
        </section>
      </main>
    </>
  );
}
