import type { Metadata } from "next";
import { FilesView } from "@/modules/files/ui/views/files-view";

// Access is governed by backend entitlements (file-count limit), not a plan gate.
export const metadata: Metadata = {
  title: "Files",
};

const Page = () => {
  return <FilesView />;
};

export default Page;