import type { Metadata } from "next";
import { FeedbackView } from "@/modules/feedback/ui/views/feedback-view";

export const metadata: Metadata = {
  title: "Customer Feedback",
};

const Page = () => {
  return <FeedbackView />;
};

export default Page;


