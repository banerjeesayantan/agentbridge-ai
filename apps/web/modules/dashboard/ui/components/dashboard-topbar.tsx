"use client";

import Image from "next/image";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { PanelLeftIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@workspace/ui/components/sidebar";

const pageTitles: Record<string, string> = {
  "/": "Playground",
  "/conversations": "Conversations",
  "/feedback": "Feedback",
  "/files": "Knowledge Base",
  "/customization": "Widget Customization",
  "/integrations": "Integrations",
  "/plugins/vapi": "Voice Assistant",
  "/billing": "Plans & Billing",
};

export const DashboardTopbar = () => {
  const pathname = usePathname();
  const title =
    pageTitles[pathname] ??
    Object.entries(pageTitles).find(([path]) => path !== "/" && pathname.startsWith(`${path}/`))?.[1] ??
    "Workspace";

  return (
    <header className="relative z-40 flex h-14 w-full shrink-0 items-center gap-3 border-b bg-background px-3 sm:h-16 sm:px-4">
      <SidebarTrigger className="size-9 shrink-0" aria-label="Toggle navigation">
        <PanelLeftIcon className="size-5" />
      </SidebarTrigger>
      <Link href="/" aria-label="AgentBridge dashboard" className="flex min-w-0 shrink-0 items-center gap-2">
        <Image src="/AgentBridge_logo.png" alt="AgentBridge logo" width={32} height={32} priority className="size-8 shrink-0 object-contain" />
        <span className="hidden truncate text-base font-semibold tracking-tight sm:inline">AgentBridge</span>
      </Link>
      <div className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
      <h1 className="min-w-0 truncate text-sm font-medium text-muted-foreground sm:text-base">{title}</h1>
      <div className="flex-1" />
      <UserButton appearance={{ elements: { avatarBox: "size-8 sm:size-9", userButtonTrigger: "rounded-full focus:ring-2 focus:ring-ring focus:ring-offset-2" } }} />
    </header>
  );
};
