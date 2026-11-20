"use client";

import Image from "next/image";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { SidebarTrigger } from "@workspace/ui/components/sidebar";

export const DashboardTopbar = () => {
  return (
    <header className="sticky top-0 z-40 flex h-16 w-full shrink-0 items-center gap-3 border-b bg-background px-4">
      <SidebarTrigger
  className="size-9 shrink-0"
  aria-label="Toggle sidebar"
/>


      <Link
        href="/"
        className="flex min-w-0 items-center gap-2"
        aria-label="Go to AgentBridge dashboard"
      >
        <Image
          src="/AgentBridge_logo.png"
          alt="AgentBridge logo"
          width={36}
          height={36}
          priority
          className="size-9 shrink-0 object-contain"
        />

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