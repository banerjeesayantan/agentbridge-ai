"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePaginatedQuery } from "convex/react";
import { api } from "@workspace/backend/_generated/api";
import { Button } from "@workspace/ui/components/button";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  MessageSquareIcon,
  RefreshCwIcon,
} from "lucide-react";

type ConversationStatus = "unresolved" | "escalated" | "resolved";

const filters: {
  label: string;
  value: ConversationStatus | undefined;
}[] = [
  { label: "All conversations", value: undefined },
  { label: "Unresolved", value: "unresolved" },
  { label: "Escalated", value: "escalated" },
  { label: "Resolved", value: "resolved" },
];

const statusStyles: Record<ConversationStatus, string> = {
  unresolved: "bg-blue-500/10 text-blue-600",
  escalated: "bg-amber-500/10 text-amber-600",
  resolved: "bg-emerald-500/10 text-emerald-600",
};

const getMessagePreview = (message: unknown): string => {
  if (!message || typeof message !== "object") {
    return "No messages yet";
  }

  const record = message as {
    message?: { content?: unknown };
    content?: unknown;
  };

  const content = record.message?.content ?? record.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          return part.text;
        }

        return "";
      })
      .filter(Boolean)
      .join(" ");
  }

  return "Open conversation to view messages";
};

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
};

export const ConversationsView = () => {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<
    ConversationStatus | undefined
  >(undefined);

  const {
    results: conversations,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.private.conversations.getMany,
    { status: statusFilter },
    { initialNumItems: 20 },
  );

  const isLoading = status === "LoadingFirstPage";
  const isLoadingMore = status === "LoadingMore";

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <header className="flex flex-col gap-4 border-b px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10">
            <MessageSquareIcon className="size-5 text-primary" />
          </div>

          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Conversations
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage customer conversations and support requests.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => {
            const isActive = statusFilter === filter.value;

            return (
              <Button
                key={filter.label}
                size="sm"
                variant={isActive ? "default" : "outline"}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </Button>
            );
          })}
        </div>
      </header>

      <section className="flex-1 overflow-y-auto p-4 sm:p-8">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-xl border bg-muted/40"
              />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
              <MessageSquareIcon className="size-6 text-muted-foreground" />
            </div>

            <h2 className="font-semibold">No conversations found</h2>

            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {statusFilter
                ? `There are no ${statusFilter} conversations right now.`
                : "Customer conversations will appear here when visitors start chatting through your widget."}
            </p>

            {statusFilter && (
              <Button
                className="mt-4"
                variant="outline"
                size="sm"
                onClick={() => setStatusFilter(undefined)}
              >
                View all conversations
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {conversations.map((conversation) => {
              const preview = getMessagePreview(conversation.lastMessage);

              return (
                <button
                  key={conversation._id}
                  type="button"
                  onClick={() =>
                    router.push(`/conversations/${conversation._id}`)
                  }
                  className="group flex w-full items-start gap-4 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
                    <MessageSquareIcon className="size-5 text-muted-foreground" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        Visitor{" "}
                        {String(conversation.contactSessionId).slice(-6)}
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[conversation.status]}`}
                      >
                        {conversation.status === "unresolved" && (
                          <Clock3Icon className="size-3" />
                        )}
                        {conversation.status === "escalated" && (
                          <AlertCircleIcon className="size-3" />
                        )}
                        {conversation.status === "resolved" && (
                          <CheckCircle2Icon className="size-3" />
                        )}
                        {conversation.status.charAt(0).toUpperCase() +
                          conversation.status.slice(1)}
                      </span>
                    </div>

                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {preview}
                    </p>

                    <p className="mt-2 text-xs text-muted-foreground">
                      Conversation ID: {String(conversation._id).slice(-10)}
                    </p>
                  </div>

                  <time className="shrink-0 pt-1 text-xs text-muted-foreground">
                    {formatDate(conversation._creationTime)}
                  </time>
                </button>
              );
            })}

            {status === "CanLoadMore" && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  onClick={() => loadMore(20)}
                >
                  Load more
                </Button>
              </div>
            )}

            {isLoadingMore && (
              <div className="flex justify-center py-4">
                <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
};