import type { ReactNode } from "react";

export function DesktopOnlyGate({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="desktop-app-content">{children}</div>
      <main
        className="mobile-access-notice"
        role="status"
        aria-labelledby="mobile-access-title"
      >
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
