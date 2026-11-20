import { AuthGuard } from "@/modules/auth/ui/components/auth-guard";
import { OrganizationGuard } from "@/modules/auth/ui/components/organization-guard";
import { DashboardSidebar } from "@/modules/dashboard/ui/components/dashboard-sidebar";
import { DashboardTopbar } from "@/modules/dashboard/ui/components/dashboard-topbar";
import { DesktopOnlyGate } from "@/modules/dashboard/ui/components/desktop-only-gate";
import { DashboardBillingBanner } from "@/modules/dashboard/ui/components/dashboard-billing-banner";
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
            <DesktopOnlyGate>
              <div className="flex h-svh min-h-0 w-full min-w-0 flex-col overflow-hidden">
                <DashboardTopbar />

                <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                  <DashboardSidebar />

                  <main className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto">
                    <DashboardBillingBanner />
                    <div className="min-h-0 flex-1">{children}</div>
                  </main>
                </div>
              </div>
            </DesktopOnlyGate>
          </SidebarProvider>
        </Provider>
      </OrganizationGuard>
    </AuthGuard>
  );
};