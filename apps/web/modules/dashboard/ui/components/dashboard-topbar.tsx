"use client";

import { UserButton } from "@clerk/nextjs";
import { PanelLeftIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { SidebarTrigger } from "@workspace/ui/components/sidebar";

/**
 * Top bar. Its height comes from the --topbar-height CSS variable set in DashboardLayout; the sidebar
 * uses the same variable, so it always starts exactly below this bar.
 */
export const DashboardTopbar = () => {
  return (
    <header className="sticky top-0 z-40 flex h-(--topbar-height) w-full shrink-0 items-center gap-3 border-b bg-background px-4">
      <SidebarTrigger
        className="size-9 shrink-0"
        aria-label="Toggle sidebar"
      >
        <PanelLeftIcon className="size-5" />
      </SidebarTrigger>

      {/* next/link (not <a>): client-side navigation, so no full reload and no loading screen. Goes straight to Conversations (Playground stays at "/" in the sidebar). */}
      <Link href="/conversations" aria-label="AgentBridge home" className="flex min-w-0 items-center gap-2">
        <Image alt="" height={36} width={36} src="/logo.png" priority className="shrink-0" />
        <span className="truncate text-lg font-semibold tracking-tight">
          AgentBridge
        </span>
      </Link>

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
