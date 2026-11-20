"use client";

import { api } from "@workspace/backend/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { useQuery } from "convex/react";
import { AlertTriangleIcon, CheckCircle2Icon, Clock3Icon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export const DashboardBillingBanner = () => {
  const [checkoutReturned, setCheckoutReturned] = useState<"success" | "cancelled" | null>(null);
  const summary = useQuery(api.private.usage.summary, checkoutReturned === "success" ? {} : "skip");

  useEffect(() => {
    const url = new URL(window.location.href);
    const checkout = url.searchParams.get("checkout");
    if (checkout !== "success" && checkout !== "cancelled") return;
    setCheckoutReturned(checkout);
    url.searchParams.delete("checkout");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  if (checkoutReturned === "cancelled") {
    return (
      <div className="px-4 pt-3">
        <Alert variant="destructive">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>Payment needs attention</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Your organization’s subscription has a payment issue. Update the payment method to keep paid features.</span>
            <Button asChild size="sm" variant="outline"><Link href="/billing">Manage billing</Link></Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!checkoutReturned) return null;

  if (checkoutReturned === "cancelled") {
    return (
      <div className="px-4 pt-3">
        <Alert>
          <AlertTitle>Checkout cancelled</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>No subscription change was made. Your organization remains on its current plan.</span>
            <Button asChild size="sm" variant="outline"><Link href="/billing">View plans</Link></Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (summary === undefined) {
    return (
      <div className="px-4 pt-3">
        <Alert>
          <Clock3Icon className="size-4" />
          <AlertTitle>Payment received — confirming your subscription</AlertTitle>
          <AlertDescription>Checking the latest organization billing status from Polar…</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (summary.pastDue) {
    return (
      <div className="px-4 pt-3">
        <Alert variant="destructive">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>Payment needs attention</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Your organization’s subscription has a payment issue. Update the payment method to keep paid features.</span>
            <Button asChild size="sm" variant="outline"><Link href="/billing">Manage billing</Link></Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const confirmed = summary.plan !== "free";
  return (
    <div className="px-4 pt-3">
      <Alert>
        {confirmed ? <CheckCircle2Icon className="size-4" /> : <Clock3Icon className="size-4" />}
        <AlertTitle className="flex flex-wrap items-center gap-2">
          {confirmed ? "Payment confirmed" : "Payment received — confirming your subscription"}
          <Badge variant="outline">{confirmed ? summary.planName : "Processing"}</Badge>
        </AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>
            {confirmed
              ? "Your organization’s plan is active. You can continue using AgentBridge."
              : "Polar is finalizing the subscription. Paid features will appear after the verified billing webhook updates your organization."}
          </span>
          <Button asChild size="sm" variant="outline"><Link href="/billing">View billing</Link></Button>
        </AlertDescription>
      </Alert>
    </div>
  );
};
