"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { SparklesIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@workspace/ui/components/button";

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

  return status === "success" ? (
    <Alert className="mx-4 mt-4">
      <SparklesIcon className="size-4" />
      <AlertTitle>Checkout completed — confirming your subscription</AlertTitle>
      <AlertDescription>
        Polar is confirming your subscription. Paid features become available
        after the verified webhook updates your organization.
      </AlertDescription>
      <Button asChild className="mt-3"><Link href="/">Return to Dashboard</Link></Button>
    </Alert>
  ) : (
    <Alert className="mx-4 mt-4">
      <AlertTitle>Checkout cancelled</AlertTitle>
      <AlertDescription>
        No new subscription was activated. Your current plan is unchanged, and
        you can return to billing whenever you are ready.
      </AlertDescription>
      <Button asChild variant="outline" className="mt-3"><Link href="/">Return to Dashboard</Link></Button>
    </Alert>
  );
}
