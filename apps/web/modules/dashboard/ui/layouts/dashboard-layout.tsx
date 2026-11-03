import { AuthGuard } from "@/modules/auth/ui/components/auth-guard";
import { OrganizationGuard } from "@/modules/auth/ui/components/organization-guard";
import { DashboardSidebar } from "@/modules/dashboard/ui/components/dashboard-sidebar";
import { DashboardTopbar } from "@/modules/dashboard/ui/components/dashboard-topbar";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { Provider } from "jotai";
import { cookies } from "next/headers";

export const DashboardLayout = async ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const cookieStore = await cookies();

  // Restore the sidebar state from the cookie.
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";

  return (
    <AuthGuard>
      <OrganizationGuard>
        <Provider>
          <SidebarProvider defaultOpen={defaultOpen}>
            {/* One variable drives the top bar height and the sidebar's top offset. */}
            <div
              className="flex h-svh min-h-0 w-full flex-col overflow-hidden"
              style={{ "--topbar-height": "4rem" } as React.CSSProperties}
            >
              {/* Shared top bar */}
              <DashboardTopbar />

              {/* Sidebar and page content */}
              <div className="flex min-h-0 flex-1">
                <DashboardSidebar />

                {/* Pages use min-h-screen; subtract the bar so they do not scroll by its height. */}
                <main className="min-w-0 flex-1 overflow-y-auto [&_.min-h-screen]:min-h-[calc(100svh-var(--topbar-height))]">
                  {children}
                </main>
              </div>
            </div>
          </SidebarProvider>
        </Provider>
      </OrganizationGuard>
    </AuthGuard>
  );
};
