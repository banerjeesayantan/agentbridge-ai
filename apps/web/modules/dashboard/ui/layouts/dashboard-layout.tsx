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
            {/* AgentBridge is a desktop workspace. Keep the application out of
                narrow mobile viewports instead of squeezing or clipping it. */}
            <div className="hidden h-svh min-h-0 w-full min-w-0 flex-col overflow-hidden min-[1024px]:flex">
              <DashboardTopbar />

              <div className="flex min-h-0 min-w-0 flex-1">
                <DashboardSidebar />

                <main className="min-h-0 min-w-0 w-full flex-1 overflow-x-auto overflow-y-auto">
                  {children}
                </main>
              </div>
            </div>

            <section
              aria-labelledby="desktop-required-title"
              className="flex min-h-svh w-full flex-col items-center justify-center bg-background px-6 text-center min-[1024px]:hidden"
            >
              <div className="max-w-sm space-y-3">
                <div aria-hidden="true" className="text-4xl">🖥️</div>
                <h1 id="desktop-required-title" className="text-xl font-semibold">
                  Open AgentBridge on a PC or laptop
                </h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  AgentBridge is a desktop workspace. For the full dashboard,
                  Playground and configuration tools, use a laptop or desktop
                  browser with a window at least 1024 pixels wide.
                </p>
              </div>
            </section>
          </SidebarProvider>
        </Provider>
      </OrganizationGuard>
    </AuthGuard>
  );
};
