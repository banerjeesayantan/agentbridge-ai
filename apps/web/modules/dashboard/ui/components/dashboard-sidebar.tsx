"use client";

import { OrganizationSwitcher } from "@clerk/nextjs";
import {
  CreditCardIcon,
  FlaskConicalIcon,
  MessageSquareTextIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LibraryBigIcon,
  Mic,
  PaletteIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";

const navigationGroups = [
  {
    title: "Customer Support",
    items: [
      { title: "Conversations", url: "/conversations", icon: InboxIcon },
      { title: "Feedback", url: "/feedback", icon: MessageSquareTextIcon },
      { title: "Knowledge Base", url: "/files", icon: LibraryBigIcon },
    ],
  },
  {
    title: "Configuration",
    items: [
      { title: "Playground", url: "/", icon: FlaskConicalIcon },
      { title: "Widget Customization", url: "/customization", icon: PaletteIcon },
      { title: "Integrations", url: "/integrations", icon: LayoutDashboardIcon },
      { title: "Voice Assistant", url: "/plugins/vapi", icon: Mic },
    ],
  },
  {
    title: "Account",
    items: [{ title: "Plans & Billing", url: "/billing", icon: CreditCardIcon }],
  },
];

export const DashboardSidebar = () => {
  const pathname = usePathname();

  const isActive = (url: string) =>
    url === "/" ? pathname === "/" : pathname === url || pathname.startsWith(`${url}/`);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
        <Link href="/" aria-label="AgentBridge dashboard" className="flex min-w-0 items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <Image
            src="/AgentBridge_logo.png"
            alt=""
            width={32}
            height={32}
            priority
            className="size-8 shrink-0 object-contain"
          />
          <span className="truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            AgentBridge
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="min-h-0 flex-1 pt-2">
        {navigationGroups.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(item.url);
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className={cn(active && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90")}
                      >
                        <Link href={item.url}>
                          <Icon className="size-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/"
          afterCreateOrganizationUrl="/"
          afterLeaveOrganizationUrl="/org-selection"
          appearance={{
            elements: {
              rootBox: "w-full min-w-0",
              organizationSwitcherTrigger: "w-full min-w-0 justify-start rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent",
              organizationPreview: "min-w-0",
              organizationPreviewTextContainer: "min-w-0",
              organizationPreviewMainIdentifier: "max-w-[9rem] truncate text-xs font-medium",
              organizationPreviewSecondaryIdentifier: "text-[11px]",
              avatarBox: "size-8 shrink-0",
              userPreview: "min-w-0",
            },
          }}
        />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
};
