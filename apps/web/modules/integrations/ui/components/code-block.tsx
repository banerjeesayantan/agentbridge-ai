"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type CopyState = "idle" | "copied" | "failed";

interface CodeBlockProps {
  code: string;
  /** Accessible name for the code region, e.g. "HTML embed snippet". */
  label: string;
  className?: string;
}

/**
 * Read-only code block with an always-visible copy button. The copy result
 * reflects what the Clipboard API actually returned, so a blocked clipboard
 * is reported as a failure rather than a success.
 */
export const CodeBlock = ({ code, label, className }: CodeBlockProps) => {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const handleCopy = async () => {
    window.clearTimeout(resetTimer.current);
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
      toast.success("Copied to clipboard");
    } catch {
      setCopyState("failed");
      toast.error("Couldn't copy automatically. Select the code and copy it manually.");
    }
    resetTimer.current = window.setTimeout(() => setCopyState("idle"), 2000);
  };

  return (
    <div className={cn("relative", className)}>
      <pre
        aria-label={label}
        // Focusable so keyboard users can scroll long snippets.
        tabIndex={0}
        className="max-h-[320px] overflow-auto rounded-md border bg-foreground p-3 pr-12 font-mono text-secondary text-xs leading-relaxed whitespace-pre-wrap break-all focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <code>{code}</code>
      </pre>
      <Button
        aria-label={
          copyState === "copied"
            ? "Copied"
            : copyState === "failed"
              ? "Copy failed, try again"
              : `Copy ${label}`
        }
        className="absolute top-2 right-2 size-7"
        onClick={handleCopy}
        size="icon"
        type="button"
        variant="secondary"
      >
        {copyState === "copied" ? (
          <CheckIcon className="size-3.5" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copyState === "copied" && "Copied to clipboard"}
        {copyState === "failed" && "Copy failed"}
      </span>
    </div>
  );
};
