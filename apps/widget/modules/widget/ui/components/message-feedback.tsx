"use client";

import { api } from "@workspace/backend/_generated/api";
import type { Id } from "@workspace/backend/_generated/dataModel";
import { Button } from "@workspace/ui/components/button";
import { useMutation } from "convex/react";
import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { useState } from "react";

interface MessageFeedbackProps {
  messageId: string;
  conversationId: Id<"conversations">;
  contactSessionId: Id<"contactSessions">;
  /** Rating already saved for this message, if any. */
  rating?: "positive" | "negative";
}

/**
 * Thumbs up/down under an AI answer. State shown comes from the saved rating
 * (server), so it never claims feedback was recorded when saving failed.
 */
export const MessageFeedback = ({ messageId, conversationId, contactSessionId, rating }: MessageFeedbackProps) => {
  const submit = useMutation(api.public.feedback.submit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askComment, setAskComment] = useState(false);
  const [comment, setComment] = useState("");
  const [commentSent, setCommentSent] = useState(false);

  const send = async (next: "positive" | "negative", text?: string) => {
    setSaving(true);
    setError(null);
    try {
      await submit({ contactSessionId, conversationId, messageId, rating: next, comment: text });
      return true;
    } catch {
      setError("Couldn't save your feedback. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const onRate = async (next: "positive" | "negative") => {
    const ok = await send(next);
    if (ok) {
      setCommentSent(false);
      setAskComment(next === "negative");
    }
  };

  return (
    <div className="mt-2 text-xs">
      <div className="flex items-center gap-1 text-muted-foreground">
        <span className="mr-1">Was this helpful?</span>
        <Button
          aria-label="Helpful"
          aria-pressed={rating === "positive"}
          className={rating === "positive" ? "text-primary" : undefined}
          disabled={saving}
          onClick={() => onRate("positive")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ThumbsUpIcon className="size-3.5" />
        </Button>
        <Button
          aria-label="Not helpful"
          aria-pressed={rating === "negative"}
          className={rating === "negative" ? "text-destructive" : undefined}
          disabled={saving}
          onClick={() => onRate("negative")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ThumbsDownIcon className="size-3.5" />
        </Button>
      </div>

      {askComment && rating === "negative" && !commentSent && (
        <form
          className="mt-1 flex gap-1"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await send("negative", comment)) {
              setCommentSent(true);
              setAskComment(false);
            }
          }}
        >
          <input
            aria-label="What went wrong?"
            className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1"
            maxLength={500}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What went wrong? (optional)"
            value={comment}
          />
          <Button disabled={saving} size="sm" type="submit" variant="outline">
            Send
          </Button>
        </form>
      )}
      {rating && !askComment && !error && <p className="mt-1 text-muted-foreground">Thanks for your feedback.</p>}
      {error && <p className="mt-1 text-destructive">{error}</p>}
    </div>
  );
};
