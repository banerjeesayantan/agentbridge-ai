import { FilesView } from "@/modules/files/ui/views/files-view";

// Access is governed by backend entitlements (file-count limit), not a plan gate.
const Page = () => {
  return <FilesView />;
};

export default Page;
