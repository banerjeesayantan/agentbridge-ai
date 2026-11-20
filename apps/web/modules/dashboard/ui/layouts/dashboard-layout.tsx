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
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <AuthGuard>
      <OrganizationGuard>
        <Provider>
          <SidebarProvider defaultOpen={defaultOpen} className="h-svh min-h-0 overflow-hidden">
            <div className="flex h-svh min-h-0 w-full min-w-0 flex-col overflow-hidden">
              <DashboardTopbar />
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <DashboardSidebar />
                <main className="h-full min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
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
