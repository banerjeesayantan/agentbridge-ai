"use client";

import { api } from "@workspace/backend/_generated/api";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Progress } from "@workspace/ui/components/progress";
import { useConvex, useQuery } from "convex/react";
import { DownloadIcon, Loader2Icon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { UpgradeWall } from "@/modules/billing/ui/components/upgrade-wall";
import { getErrorData, getErrorMessage, isLimitError } from "@/modules/billing/errors";

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

export const FeedbackView = () => {
  const summary = useQuery(api.private.feedback.summary);
  const convex = useConvex();
  const [exporting, setExporting] = useState(false);
  const [wall, setWall] = useState<string | null>(null);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows = await convex.query(api.private.feedback.exportAll, {});
      const csv = [
        "conversation_id,rating,comment,time",
        ...rows.map((r) => [r.conversationId, r.rating, csvCell(r.comment), r.at].join(",")),
      ].join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "feedback.csv" });
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (isLimitError(error)) setWall(getErrorData(error)?.message ?? null);
      else toast.error(getErrorMessage(error, "Export failed. Please try again."));
    } finally {
      setExporting(false);
    }
  };

  if (summary === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-muted text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" /> Loading feedback…
      </div>
    );
  }

  const negativePct = summary.total ? 100 - (summary.positivePct ?? 0) : null;

  return (
    <div className="flex min-h-screen flex-col bg-muted p-8">
      <UpgradeWall onOpenChange={(o) => !o && setWall(null)} open={wall !== null} reason={wall ?? undefined} />
      <div className="mx-auto w-full max-w-screen-md space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl md:text-4xl">Customer Feedback</h1>
          <p className="text-muted-foreground">How customers rate the AI&apos;s answers in your widget.</p>
        </div>

        {summary.total === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              No feedback yet. Customers can rate each AI answer with a thumbs up or down in the chat widget.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{summary.total.toLocaleString()} ratings</CardTitle>
              <CardDescription>
                {summary.truncated ? "Showing the most recent 5,000 ratings." : "All ratings to date."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-1.5"><ThumbsUpIcon className="size-4" /> Positive</span>
                  <span className="tabular-nums">{summary.positivePct}% ({summary.positive})</span>
                </div>
                <Progress aria-label="Positive feedback share" value={summary.positivePct ?? 0} />
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-1.5"><ThumbsDownIcon className="size-4" /> Negative</span>
                  <span className="tabular-nums">{negativePct}% ({summary.negative})</span>
                </div>
                <Progress aria-label="Negative feedback share" value={negativePct ?? 0} />
              </div>
            </CardContent>
          </Card>
        )}

        {summary.total > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div className="space-y-1">
                <CardTitle>Recent feedback</CardTitle>
                <CardDescription>
                  {summary.advanced ? "Latest 50 with comments." : "Latest 5 ratings. Comments and reports are on Pro."}
                </CardDescription>
              </div>
              <Button disabled={exporting} onClick={exportCsv} size="sm" type="button" variant="outline">
                {exporting ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
                Export CSV
              </Button>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {summary.recent.map((item) => (
                  <li className="flex items-start gap-3 py-3 text-sm" key={item.id}>
                    <Badge variant={item.rating === "positive" ? "secondary" : "destructive"}>
                      {item.rating === "positive" ? "Positive" : "Negative"}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      {item.comment ? <p className="break-words">{item.comment}</p> : <p className="text-muted-foreground">No comment</p>}
                      <p className="text-muted-foreground text-xs">
                        {new Date(item.at).toLocaleString()} ·{" "}
                        <Link className="underline underline-offset-4" href={`/conversations/${item.conversationId}`}>
                          View conversation
                        </Link>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
