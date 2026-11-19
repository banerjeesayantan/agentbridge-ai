"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { SparklesIcon, XIcon } from "lucide-react";
import Link from "next/link";

export function DashboardCheckoutNotice() {
  const [status, setStatus] = useState<"success" | "cancelled" | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");

    if (checkout === "success" || checkout === "return") {
      setStatus("success");
    } else if (checkout === "cancelled" || checkout === "cancel") {
      setStatus("cancelled");
    }

    if (checkout) {
      params.delete("checkout");
      const query = params.toString();
      const cleanUrl = query
        ? `${window.location.pathname}?${query}`
        : window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
    }
  }, []);

  if (!status) return null;

  const dismissButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="absolute right-2 top-2 size-8"
      aria-label="Dismiss checkout notification"
      title="Dismiss"
      onClick={() => setStatus(null)}
    >
      <XIcon className="size-4" />
    </Button>
  );

  return status === "success" ? (
    <Alert className="relative mx-4 mt-4 pr-12">
      {dismissButton}
      <SparklesIcon className="size-4" />
      <AlertTitle>Checkout completed — confirming your subscription</AlertTitle>
      <AlertDescription>
        Polar is confirming your subscription. Paid features become available
        after the verified webhook updates your organization.
      </AlertDescription>
      <Button asChild className="mt-3"><Link href="/">Return to Dashboard</Link></Button>
    </Alert>
  ) : (
    <Alert className="relative mx-4 mt-4 pr-12">
      {dismissButton}
      <AlertTitle>Checkout cancelled</AlertTitle>
      <AlertDescription>
        No new subscription was activated. Your current plan is unchanged, and
        you can return to billing whenever you are ready.
      </AlertDescription>
      <Button asChild variant="outline" className="mt-3"><Link href="/">Return to Dashboard</Link></Button>
    </Alert>
  );
}
