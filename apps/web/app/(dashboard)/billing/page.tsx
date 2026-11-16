import type { Metadata } from "next";
import { BillingView } from "@/modules/billing/ui/views/billing-view";

export const metadata: Metadata = {
  title: "Billing",
};

const Page = () => {
  return <BillingView />;
};

export default Page;