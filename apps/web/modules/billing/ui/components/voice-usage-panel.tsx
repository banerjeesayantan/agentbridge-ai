"use client";

import { api } from "@workspace/backend/_generated/api";
import { formatUsd } from "@workspace/backend/lib/money";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Progress } from "@workspace/ui/components/progress";
import { useQuery } from "convex/react";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";

// "business" is the internal identifier; customers see "Enterprise".
const PLAN_LABEL: Record<string, string> = { free: "Free", pro: "Pro", business: "Enterprise" };

const STATUS: Record<string, { label: string; tone: "default" | "secondary" | "destructive"; message?: string }> = {
  available: { label: "Voice available", tone: "default" },
  plan_required: { label: "Not included", tone: "secondary", message: "Voice calls are included with Pro and Enterprise. Upgrade to turn them on." },
  suspended: { label: "Suspended", tone: "destructive", message: "Voice is currently suspended for your organization. Contact support to restore it." },
  not_set_up: { label: "Setting up", tone: "secondary", message: "Your voice assistant is still being set up. It will be ready shortly." },
  budget_used: { label: "Budget used", tone: "destructive", message: "Your voice budget for this period has been used. It renews with your next billing period." },
};

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const fmtDuration = (seconds: number | null) =>
  seconds === null ? "n/a" : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;

export const VoiceUsagePanel = () => {
  const summary = useQuery(api.features.voice.private.voiceBilling.summary);

  if (summary === undefined) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
          <Loader2Icon className="size-4 animate-spin" /> Loading voice usage…
        </CardContent>
      </Card>
    );
  }

  const status = STATUS[summary.status] ?? STATUS.available!;
  const used = summary.spentMicro + summary.reservedMicro;
  const pct = summary.budgetMicro > 0 ? Math.min(100, Math.round((used / summary.budgetMicro) * 100)) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Voice budget</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{PLAN_LABEL[summary.plan] ?? summary.plan}</Badge>
            <Badge variant={status.tone}>{status.label}</Badge>
          </div>
        </div>
        <CardDescription>
          {summary.budgetMicro > 0
            ? `Period ${fmtDate(summary.periodStart)} to ${fmtDate(summary.periodEnd)}`
            : "Voice is not part of your current plan."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.message && (
          <Alert variant={status.tone === "destructive" ? "destructive" : "default"}>
            <AlertTriangleIcon className="size-4" />
            <AlertTitle>{status.label}</AlertTitle>
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
        )}

        {summary.budgetMicro > 0 && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span>Used this period</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatUsd(summary.spentMicro)} of {formatUsd(summary.budgetMicro)} · {formatUsd(summary.remainingMicro)} left
                </span>
              </div>
              <Progress aria-label="Voice budget used" value={pct} />
              {summary.reservedMicro > 0 && (
                <p className="text-muted-foreground text-xs">
                  {formatUsd(summary.reservedMicro)} is held for calls in progress. It is not spent until the call is billed.
                </p>
              )}
            </div>

            {summary.pendingCostCalls > 0 && (
              <p className="text-muted-foreground text-xs">
                {summary.pendingCostCalls} recent call(s) are waiting for final cost confirmation.
              </p>
            )}

            {summary.recentCalls.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="font-medium text-sm">Recent calls</h3>
                <ul className="divide-y rounded-md border text-sm">
                  {summary.recentCalls.map((c, i) => (
                    <li key={i} className="flex items-center justify-between px-3 py-2">
                      <span className="text-muted-foreground">
                        {new Date(c.endedAtMs).toLocaleString()} · {fmtDuration(c.durationSeconds)}
                      </span>
                      <span className="tabular-nums">{c.chargeMicro === null ? "Pending" : formatUsd(c.chargeMicro)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
