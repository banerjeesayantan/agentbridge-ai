import { MonitorIcon } from "lucide-react";

export const DesktopOnlyGate = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return (
    <>
      <style>{`
        @media (max-width: 1023px), (hover: none) and (pointer: coarse) {
          .agentbridge-desktop-content {
            display: none !important;
          }

          .agentbridge-desktop-notice {
            display: flex !important;
          }
        }
      `}</style>

      <div className="agentbridge-desktop-content">{children}</div>

      <main className="agentbridge-desktop-notice hidden min-h-svh w-full items-center justify-center bg-background px-6 text-center">
        <div className="mx-auto flex max-w-md flex-col items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
            <MonitorIcon className="size-7 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-semibold">
            Open AgentBridge on a PC or laptop
          </h1>
          <p className="text-sm text-muted-foreground">
            The AgentBridge dashboard is designed for larger screens. Please
            switch to a desktop or laptop to continue.
          </p>
        </div>
      </main>
    </>
  );
};
