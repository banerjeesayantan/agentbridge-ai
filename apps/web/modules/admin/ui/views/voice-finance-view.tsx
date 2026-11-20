"use client";

import { api } from "@workspace/backend/_generated/api";
import { formatUsd } from "@workspace/backend/lib/money";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Platform-admin financial dashboard. Access is enforced by the backend on
 * every query and mutation (PLATFORM_ADMIN_USER_IDS); this view only avoids
 * showing an error to people who are not admins.
 */

const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Card>
    <CardHeader className="pb-2">
      <CardDescription>{label}</CardDescription>
      <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
    </CardHeader>
    {hint && <CardContent className="text-muted-foreground text-xs">{hint}</CardContent>}
  </Card>
);

const errorText = (e: unknown) => {
  const data = (e as { data?: { message?: string } | string } | undefined)?.data;
  return typeof data === "object" && data?.message ? data.message : "That action could not be completed.";
};

export const VoiceFinanceView = () => {
  const gate = useQuery(api.features.voice.private.voiceAdmin.amIAdmin);
  if (gate === undefined) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" /> Checking access…
      </div>
    );
  }
  if (!gate.isAdmin) {
    return (
      <div className="mx-auto max-w-screen-sm p-8">
        <Alert variant="destructive">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>No access</AlertTitle>
          <AlertDescription>This page is only available to platform administrators.</AlertDescription>
        </Alert>
      </div>
    );
  }
  return <Dashboard />;
};

const Dashboard = () => {
  const data = useQuery(api.features.voice.private.voiceAdmin.overview);
  const suspend = useMutation(api.features.voice.private.voiceAdmin.suspendOrganizationVoice);
  const restore = useMutation(api.features.voice.private.voiceAdmin.restoreOrganizationVoice);
  const setProvider = useMutation(api.features.voice.private.voiceAdmin.setProviderAccount);
  const [balance, setBalance] = useState("");

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  if (data === undefined) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" /> Loading financials…
      </div>
    );
  }

  const provisional = data.totals.pendingCostCalls > 0;

  return (
    <div className="flex min-h-screen flex-col bg-muted p-8">
      <div className="mx-auto w-full max-w-screen-xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl md:text-4xl">Voice finance</h1>
          <p className="text-muted-foreground">
            Revenue, actual Vapi cost and contribution, kept separate from customer allowances and the provider balance.
          </p>
        </div>

        {(data.provider.lowBalance || data.provider.paused || provisional || data.truncated) && (
          <Alert variant="destructive">
            <AlertTriangleIcon className="size-4" />
            <AlertTitle>Needs attention</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {data.provider.paused && <li>Voice is paused for every organization.</li>}
                {data.provider.lowBalance && <li>The provider balance is at or below the alert threshold.</li>}
                {provisional && <li>{data.totals.pendingCostCalls} call(s) have no confirmed cost yet, so contribution is provisional.</li>}
                {data.truncated && <li>Only the most recent organizations are shown.</li>}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Stat label="Net collected" value={formatUsd(Math.max(0, data.totals.netCollectedMicro))} hint="Verified Polar payments minus refunds and reported platform fees. Tax excluded." />
          <Stat label="Actual Vapi expense" value={formatUsd(data.totals.vapiExpenseKnownMicro)} hint="Confirmed provider costs only; pending costs are not counted as zero." />
          <Stat label={provisional ? "Contribution (provisional)" : "Contribution"} value={formatUsd(Math.max(0, data.totals.contributionMicro))} hint="Net collected minus actual Vapi expense, before infrastructure costs." />
          <Stat label="Wallet liability" value={formatUsd(data.liabilities.walletRemainingMicro)} hint={`${formatUsd(data.liabilities.reservedMicro)} currently held for calls in progress (not earnings).`} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Provider account</CardTitle>
            <CardDescription>
              Central Vapi account. The balance is entered manually: no verified provider balance source is connected.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-muted-foreground text-xs">Balance</p>
              <p className="text-xl tabular-nums">
                {data.provider.balanceMicro === null ? "Not set" : formatUsd(data.provider.balanceMicro)}{" "}
                {data.provider.balanceSource && <Badge variant="outline">{data.provider.balanceSource}</Badge>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input className="w-40" inputMode="decimal" placeholder="Balance (USD)" value={balance} onChange={(e) => setBalance(e.target.value)} />
              <Button
                variant="outline"
                onClick={() => {
                  const usd = Number(balance);
                  if (!Number.isFinite(usd) || usd < 0) return toast.error("Enter a non-negative amount in USD.");
                  void run(() => setProvider({ balanceMicro: Math.round(usd * 1_000_000) }), "Balance updated");
                }}
              >
                Save manual balance
              </Button>
            </div>
            <Button
              variant={data.provider.paused ? "default" : "destructive"}
              onClick={() => void run(() => setProvider({ paused: !data.provider.paused }), data.provider.paused ? "Voice resumed" : "Voice paused")}
            >
              {data.provider.paused ? "Resume all voice" : "Pause all voice"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organizations</CardTitle>
            <CardDescription>
              Allocation of net collected revenue (a plan for the money, not earnings):{" "}
              {data.allocation.map((p) => `${p.key} ${(p.bps / 100).toFixed(0)}%`).join(", ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Held</TableHead>
                  <TableHead className="text-right">Net collected</TableHead>
                  <TableHead className="text-right">Vapi expense</TableHead>
                  <TableHead className="text-right">Contribution</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.organizations.map((o) => (
                  <TableRow key={o.organizationId}>
                    <TableCell className="font-mono text-xs">{o.organizationId}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(o.wallet.budgetMicro)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(o.wallet.spentMicro)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(o.wallet.reservedMicro)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(Math.max(0, o.accounting.netCollectedMicro))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(o.accounting.vapiExpenseKnownMicro)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.accounting.contributionMicro < 0 ? "-" : ""}
                      {formatUsd(Math.abs(o.accounting.contributionMicro))}
                      {o.accounting.provisional && " *"}
                    </TableCell>
                    <TableCell className="space-x-1">
                      {o.overBudget && <Badge variant="destructive">Over budget</Badge>}
                      {!o.overBudget && o.nearBudget && <Badge variant="secondary">Near budget</Badge>}
                      {!o.accounting.platformFeesReported && o.accounting.grossPaymentsMicro > 0 && <Badge variant="outline">Fees not reported</Badge>}
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => void run(() => suspend({ organizationId: o.organizationId }), "Voice suspended")}>
                        Suspend
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void run(() => restore({ organizationId: o.organizationId }), "Voice restored")}>
                        Restore
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {data.organizations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      No voice activity yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <p className="mt-2 text-muted-foreground text-xs">* Provisional: at least one call has no confirmed cost yet.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Provider cost alerts</CardTitle>
            <CardDescription>
              Durable alerts when confirmed provider costs exceed reservations or organization wallet budgets.
              Showing the latest 100 alerts.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alert</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Provider call</TableHead>
                  <TableHead className="text-right">Actual cost</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Wallet budget</TableHead>
                  <TableHead className="text-right">Resulting spend</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.costAlerts.map((alert) => (
                  <TableRow key={alert._id}>
                    <TableCell>
                      {alert.alertType === "BUDGET_EXCEEDED" ? (
                        <Badge variant="destructive">Budget exceeded</Badge>
                      ) : (
                        <Badge variant="outline">Reservation overrun</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{alert.organizationId}</TableCell>
                    <TableCell className="font-mono text-xs">{alert.providerCallId}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(alert.actualCostMicro)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(alert.reservedMicro)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(alert.budgetMicro)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(alert.resultingSpentMicro)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                      {new Date(alert.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
                {data.costAlerts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      No provider cost alerts recorded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Reconciliation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Calls with pending cost: {data.reconciliation.pendingCostExpenses}</p>
              <p>Holds released with no provider report: {data.reconciliation.expiredHoldsWithoutReport}</p>
              <p>Calls with no matching reservation: {data.reconciliation.unreservedCalls}</p>
              <p>Calls that carried assistant overrides: {data.reconciliation.callsWithOverrides}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent admin activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {data.audit.map((a, i) => (
                  <li key={i} className="text-muted-foreground">
                    {new Date(a.at).toLocaleString()} · {a.actor} · {a.action} · {a.target}
                  </li>
                ))}
                {data.audit.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
