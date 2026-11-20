"use client";

import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";

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

  const message =
    status === "success"
      ? "Checkout successful — your subscription is being confirmed."
      : "Checkout cancelled — no changes were made to your current plan.";

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-4 mt-3 flex min-h-10 items-center gap-3 rounded-md border bg-muted/70 px-3 py-2 text-sm"
    >
      <p className="min-w-0 flex-1 truncate">{message}</p>
      <button
        type="button"
        onClick={() => setStatus(null)}
        aria-label="Dismiss checkout notification"
        title="Dismiss"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
