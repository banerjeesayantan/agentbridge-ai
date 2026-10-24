"use client";

import { api } from "@workspace/backend/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Progress } from "@workspace/ui/components/progress";
import { useQuery } from "convex/react";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

const Meter = ({ label, used, limit }: { label: string; used: number; limit: number }) => {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {used.toLocaleString()} / {limit.toLocaleString()} · {Math.max(0, limit - used).toLocaleString()} left
        </span>
      </div>
      <Progress aria-label={`${label} used`} value={pct} />
    </div>
  );
};

export const UsagePanel = () => {
  const summary = useQuery(api.private.usage.summary);

  if (summary === undefined) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
          <Loader2Icon className="size-4 animate-spin" /> Loading usage…
        </CardContent>
      </Card>
    );
  }

  const { usage, limits } = summary;
  const aiExhausted = usage.aiMessages >= limits.aiMessages;
  const filesExhausted = usage.knowledgeFiles >= limits.knowledgeFiles;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Current plan: {summary.planName}</CardTitle>
          <Badge variant="outline">{summary.status === "none" ? "free" : summary.status.replace("_", " ")}</Badge>
        </div>
        <CardDescription>
          AI message allowance resets on {fmtDate(summary.resetsAt)}.
          {summary.cancelAtPeriodEnd && ` Your plan ends on ${fmtDate(summary.resetsAt)}; you'll move to Free after that.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {summary.pastDue && summary.graceEndsAt && (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Payment failed</AlertTitle>
            <AlertDescription>
              {summary.plan === "free"
                ? "The grace period has ended and your organization is on Free limits. Update your payment method to restore your plan. No data was deleted."
                : `Update your payment method by ${fmtDate(summary.graceEndsAt)} to keep your plan. No data will be deleted.`}
            </AlertDescription>
          </Alert>
        )}
        <Meter label="AI messages" limit={limits.aiMessages} used={usage.aiMessages} />
        <Meter label="Knowledge-base files" limit={limits.knowledgeFiles} used={usage.knowledgeFiles} />
        <p className="text-muted-foreground text-sm">
          Voice assistant: {limits.voice ? "included" : "not included in this plan"}
        </p>
        {(aiExhausted || filesExhausted) && (
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>Limit reached</AlertTitle>
            <AlertDescription>
              {aiExhausted &&
                "New customer messages are saved and handed to your team instead of getting an AI reply until the allowance resets. "}
              {filesExhausted && "You can't add more knowledge-base files until you remove some. "}
              Upgrade below for higher limits.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};
