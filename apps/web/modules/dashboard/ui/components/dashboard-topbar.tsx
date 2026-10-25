"use client";

import { UserButton } from "@clerk/nextjs";
import { PanelLeftIcon } from "lucide-react";
import { SidebarTrigger } from "@workspace/ui/components/sidebar";

export const DashboardTopbar = () => {
  return (
    <header className="sticky top-0 z-40 flex h-16 w-full shrink-0 items-center gap-3 border-b bg-background px-4">
      <SidebarTrigger
        className="size-9 shrink-0"
        aria-label="Toggle sidebar"
      >
        <PanelLeftIcon className="size-5" />
      </SidebarTrigger>

      <a href="/" className="flex min-w-0 items-center gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-lg font-bold text-sidebar-primary-foreground">
          A
        </span>
        <span className="truncate text-lg font-semibold tracking-tight">
          AgentBridge
        </span>
      </a>

      <div className="flex-1" />

      <div className="flex shrink-0 items-center">
        <UserButton
          appearance={{
            elements: {
              avatarBox: "size-9",
              userButtonTrigger:
                "rounded-full focus:ring-2 focus:ring-ring focus:ring-offset-2",
            },
          }}
        />
      </div>
    </header>
  );
};