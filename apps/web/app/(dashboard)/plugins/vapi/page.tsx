import { FeatureGate } from "@/modules/billing/ui/components/feature-gate";
import { VapiView } from "@/modules/plugins/ui/views/vapi-view";

const Page = () => {
  return (
    <FeatureGate feature="voice">
      <VapiView />
    </FeatureGate>
  );
};

export default Page;
