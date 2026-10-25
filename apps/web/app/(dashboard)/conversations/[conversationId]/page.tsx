
import { ConversationIdView } from "@/modules/dashboard/ui/views/conversation-id-view";
import type { Id } from "@workspace/backend/_generated/dataModel";

interface PageProps {
  params: Promise<{
    conversationId: string;
  }>;
}

const Page = async ({ params }: PageProps) => {
  const { conversationId } = await params;

  return (
    <ConversationIdView
      conversationId={conversationId as Id<"conversations">}
    />
  );
};

export default Page;
