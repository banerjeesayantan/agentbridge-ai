import type { Metadata } from "next";
import { CustomizationView } from "@/modules/customization/ui/views/customization-view";

export const metadata: Metadata = {
  title: "Customization",
};

const Page = () => {
  return <CustomizationView />;
};

export default Page;