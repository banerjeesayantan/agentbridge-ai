import type { Metadata } from "next";
import { PlaygroundView } from "@/modules/playground/ui/views/playground-view";
import { DashboardCheckoutNotice } from "@/modules/dashboard/ui/components/dashboard-checkout-notice";

export const metadata: Metadata = {
  title: { absolute: "AgentBridge AI" },
};

const Page = () => {
  return (
    <>
      <DashboardCheckoutNotice />
      <PlaygroundView />
    </>
  );
};

export default Page;
