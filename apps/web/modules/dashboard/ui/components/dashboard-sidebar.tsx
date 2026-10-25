"use client";

import { useOrganization } from "@clerk/nextjs";
import {
  CreditCardIcon,
  FlaskConicalIcon,
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

const customerSupportItems = [
  {
    title: "Conversations",
    url: "/conversations",
    icon: InboxIcon,
  },
  {
    title: "Knowledge Base",
    url: "/files",
    icon: LibraryBigIcon,
  },
];

const configurationItems = [
  {
    title: "Playground",
    url: "/",
    icon: FlaskConicalIcon,
  },
  {
    title: "Widget Customization",
    url: "/customization",
    icon: PaletteIcon,
  },
  {
    title: "Integrations",
    url: "/integrations",
    icon: LayoutDashboardIcon,
  },
  {
    title: "Voice Assistant",
    url: "/plugins/vapi",
    icon: Mic,
  },
];

const accountItems = [
  {
    title: "Plans & Billing",
    url: "/billing",
    icon: CreditCardIcon,
  },
];

const navigationGroups = [
  {
    title: "Customer Support",
    items: customerSupportItems,
  },
  {
    title: "Configuration",
    items: configurationItems,
  },
  {
    title: "Account",
    items: accountItems,
  },
];

const OrganizationFooter = () => {
  const { organization, membership, isLoaded } = useOrganization();

  if (!isLoaded || !organization) {
    return null;
  }

  const role = membership?.role
    ?.replace(/^org:/, "")
    .replace(/_/g, " ");

  const formattedRole = role
    ? role.charAt(0).toUpperCase() + role.slice(1)
    : "Member";

  return (
  <div className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
  {organization.imageUrl ? (
    <Image
      src={organization.imageUrl}
      alt={`${organization.name} logo`}
      width={36}
      height={36}
      unoptimized
      className="size-9 shrink-0 rounded-lg object-cover"
    />
  ) : (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sm font-semibold">
      {organization.name.charAt(0).toUpperCase()}
    </div>
  )}

      <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
        <p className="truncate text-sm font-semibold">
          {organization.name}
        </p>
        <p className="truncate text-xs capitalize text-muted-foreground">
          {formattedRole}
        </p>
      </div>
    </div>
  );
};

export const DashboardSidebar = () => {
  const pathname = usePathname();

  const isActive = (url: string) => {
    if (url === "/") {
      return pathname === "/";
    }

    return pathname === url || pathname.startsWith(`${url}/`);
  };

  return (
    <Sidebar className="group" collapsible="icon">
      <SidebarHeader />

      <SidebarContent className="flex-1 pt-11">
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
                        className={cn(
                          active &&
                            "bg-gradient-to-b from-sidebar-primary to-[#0b63f3]! text-sidebar-primary-foreground! hover:to-[#0b63f3]/90!"
                        )}
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

      <SidebarFooter>
        <OrganizationFooter />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
};
