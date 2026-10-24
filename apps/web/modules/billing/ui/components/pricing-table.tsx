"use client";

import { api } from "@workspace/backend/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { cn } from "@workspace/ui/lib/utils";
import { useAction, useQuery } from "convex/react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "../../errors";

type PlanKey = "free" | "pro" | "business";
type CatalogPlan = {
  plan: "pro" | "business";
  name: string;
  available: boolean;
  reason: "not_configured" | "load_failed" | null;
  priceAmount: number | null;
  currency: string | null;
  interval: string | null;
};

const formatPrice = (plan: CatalogPlan) => {
  if (plan.priceAmount === null || !plan.currency) return null;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: plan.currency.toUpperCase() }).format(
    plan.priceAmount / 100,
  );
};

export const PricingTable = () => {
  const summary = useQuery(api.private.usage.summary);
  const getCatalog = useAction(api.private.billing.getCatalog);
  const createCheckout = useAction(api.private.billing.createCheckout);
  const createPortalSession = useAction(api.private.billing.createPortalSession);

  const [catalog, setCatalog] = useState<CatalogPlan[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [returned, setReturned] = useState(false);

  useEffect(() => {
    setReturned(new URLSearchParams(window.location.search).get("checkout") === "return");
    getCatalog({})
      .then((result) => setCatalog(result.plans as CatalogPlan[]))
      .catch((error) => setCatalogError(getErrorMessage(error, "Couldn't load plans.")));
  }, [getCatalog]);

  const redirect = async (key: string, getUrl: () => Promise<{ url: string }>) => {
    setPending(key);
    try {
      const { url } = await getUrl();
      window.location.assign(url);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't start that action. Please try again."));
      setPending(null);
    }
  };

  if (summary === undefined || (catalog === null && !catalogError)) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" /> Loading plans…
      </div>
    );
  }

  const current = summary.plan as PlanKey;
  const isPaid = current !== "free";

  const describe = (plan: PlanKey) => {
    const { limits } = summary.plans[plan];
    return [
      `${limits.aiMessages.toLocaleString()} AI messages per billing period`,
      `${limits.knowledgeFiles.toLocaleString()} knowledge-base files`,
      limits.voice ? "Voice assistant" : "No voice assistant",
      `Up to ${limits.members} organization member${limits.members === 1 ? "" : "s"}`,
    ];
  };

  const cards: { key: PlanKey; catalog?: CatalogPlan }[] = [
    { key: "free" },
    ...(["pro", "business"] as const).map((key) => ({ key, catalog: catalog?.find((p) => p.plan === key) })),
  ];

  return (
    <div className="space-y-4" id="plans">
      {returned && (
        <Alert>
          <AlertTitle>Thanks, we&apos;re confirming your payment</AlertTitle>
          <AlertDescription>
            Your plan changes when Polar confirms the payment, usually within a minute. This page updates by itself.
            Returning from checkout alone doesn&apos;t unlock anything.
          </AlertDescription>
        </Alert>
      )}
      {catalogError && (
        <Alert variant="destructive">
          <AlertTitle>Plans unavailable</AlertTitle>
          <AlertDescription>{catalogError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {cards.map(({ key, catalog: entry }) => {
          const isCurrent = key === current;
          const price = key === "free" ? "$0" : entry ? formatPrice(entry) : null;
          const purchasable = key !== "free" && !!entry?.available && price !== null;

          return (
            <Card className={cn("flex flex-col", isCurrent && "border-primary ring-1 ring-primary")} key={key}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{summary.plans[key].name}</CardTitle>
                  {isCurrent && <Badge>Current plan</Badge>}
                </div>
                <CardDescription>
                  {key === "free" ? (
                    <span className="font-semibold text-foreground text-2xl">$0</span>
                  ) : price ? (
                    <>
                      <span className="font-semibold text-foreground text-2xl">{price}</span>
                      {entry?.interval && <span> / {entry.interval}</span>}
                    </>
                  ) : (
                    <span>
                      {entry?.reason === "load_failed" ? "Price unavailable right now" : "Not available for purchase yet"}
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-2 text-sm">
                  {describe(key).map((line) => (
                    <li className="flex items-start gap-2" key={line}>
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      {line}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                {key === "free" ? (
                  <Button className="w-full" disabled variant="outline">
                    {isCurrent ? "Your current plan" : "Included"}
                  </Button>
                ) : isCurrent ? (
                  <Button
                    className="w-full"
                    disabled={pending === "portal"}
                    onClick={() => redirect("portal", () => createPortalSession({}))}
                    variant="outline"
                  >
                    {pending === "portal" && <Loader2Icon className="animate-spin" />}
                    Manage subscription
                  </Button>
                ) : isPaid ? (
                  <Button
                    className="w-full"
                    disabled={pending === "portal"}
                    onClick={() => redirect("portal", () => createPortalSession({}))}
                    variant="outline"
                  >
                    Change plan in portal
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    disabled={!purchasable || pending !== null}
                    onClick={() => redirect(key, () => createCheckout({ plan: key as "pro" | "business" }))}
                  >
                    {pending === key && <Loader2Icon className="animate-spin" />}
                    {purchasable ? `Upgrade to ${summary.plans[key].name}` : "Unavailable"}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        Need more than Business? Enterprise plans are arranged directly with us. Contact support for custom limits.
      </p>
    </div>
  );
};
