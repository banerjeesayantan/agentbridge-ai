"use client";

import { api } from "@workspace/backend/_generated/api";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Progress } from "@workspace/ui/components/progress";
import { useQuery } from "convex/react";
import Link from "next/link";

/** Compact plan + usage summary for the main page. Renders nothing until loaded. */
export const UsageStrip = () => {
  const summary = useQuery(api.private.usage.summary);
  if (!summary) return null;

  const { usage, limits } = summary;
  const pct = limits.aiMessages ? Math.min(100, Math.round((usage.aiMessages / limits.aiMessages) * 100)) : 100;
  const exhausted = usage.aiMessages >= limits.aiMessages;
  const near = pct >= 80;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background px-4 py-2 text-sm">
      <Badge variant="outline">{summary.planName} plan</Badge>
      <div className="flex min-w-[220px] flex-1 items-center gap-3">
        <span className="shrink-0 text-muted-foreground tabular-nums">
          AI messages {usage.aiMessages.toLocaleString()} / {limits.aiMessages.toLocaleString()}
        </span>
        <Progress aria-label="AI messages used" className="max-w-48" value={pct} />
      </div>
      <span className="text-muted-foreground tabular-nums">
        Knowledge files {usage.knowledgeFiles} / {limits.knowledgeFiles}
      </span>
      {(near || summary.plan === "free") && (
        <Button asChild size="sm" variant={exhausted ? "default" : "outline"}>
          <Link href="/billing#plans">{exhausted ? "Upgrade to continue" : "Upgrade"}</Link>
        </Button>
      )}
    </div>
  );
};
