import type { Metadata } from "next";
import { PlaygroundView } from "@/modules/playground/ui/views/playground-view";

export const metadata: Metadata = {
  title: { absolute: "AgentBridge AI" },
};

const Page = () => {
  return <PlaygroundView />;
};

export default Page;