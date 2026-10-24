"use client";

import { api } from "@workspace/backend/_generated/api";
import { useQuery } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { PremiumFeatureOverlay } from "./premium-feature-overlay";

/**
 * Presentation-only: the backend enforces the same entitlement, so hiding
 * this UI is never the security boundary. Loads the real entitlement before
 * deciding, instead of assuming "no subscription".
 */
export const FeatureGate = ({
  feature,
  children,
}: {
  feature: "voice";
  children: React.ReactNode;
}) => {
  const summary = useQuery(api.private.usage.summary);

  if (summary === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <Loader2Icon className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!summary.limits[feature]) {
    return <PremiumFeatureOverlay>{children}</PremiumFeatureOverlay>;
  }

  return <>{children}</>;
};
