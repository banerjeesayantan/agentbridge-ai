"use client";

import { PricingTable } from "../components/pricing-table";
import { UsagePanel } from "../components/usage-panel";

export const BillingView = () => {
  return (
    <div className="flex min-h-screen flex-col bg-muted p-8">
      <div className="mx-auto w-full max-w-screen-lg">
        <div className="space-y-2">
          <h1 className="text-2xl md:text-4xl">Plans & Billing</h1>
          <p className="text-muted-foreground">
            Your usage, your plan, and what an upgrade adds.
          </p>
        </div>

        <div className="mt-8 space-y-8">
          <UsagePanel />
          <PricingTable />
        </div>
      </div>
    </div>
  );
};
