
"use client";

import { api } from "@workspace/backend/_generated/api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";
import { useAction, useQuery } from "convex/react";
import {
  ArrowRightIcon,
  CheckIcon,
  Loader2Icon,
  SparklesIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "../../errors";

type PlanKey = "free" | "pro" | "enterprise";
type PaidPlanKey = Exclude<PlanKey, "free">;

type CatalogPlan = {
  plan: PaidPlanKey;
  name: string;
  available: boolean;
  reason: "not_configured" | "load_failed" | null;
  priceAmount: number | null;
  currency: string | null;
  interval: string | null;
};

const PLAN_KEYS: PlanKey[] = ["free", "pro", "enterprise"];

const PLAN_NAMES: Record<PlanKey, string> = {
  free: "Free",
  pro: "Pro",
  enterprise: "Enterprise",
};

const formatPrice = (plan: CatalogPlan): string | null => {
  if (plan.priceAmount === null || !plan.currency) {
    return null;
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: plan.currency.toUpperCase(),
    }).format(plan.priceAmount / 100);
  } catch {
    return null;
  }
};

export const PricingTable = () => {
  const summary = useQuery(api.private.usage.summary);
  const getCatalog = useAction(api.private.billing.getCatalog);
  const createCheckout = useAction(api.private.billing.createCheckout);
  const createPortalSession = useAction(
    api.private.billing.createPortalSession,
  );

  const [catalog, setCatalog] = useState<CatalogPlan[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<
    "success" | "cancelled" | null
  >(null);

  useEffect(() => {
    let cancelled = false;

    getCatalog({})
      .then((result) => {
        if (cancelled) return;

        setCatalog(result.plans as CatalogPlan[]);
        setCatalogError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;

        setCatalogError(
          getErrorMessage(error, "Couldn't load plan prices."),
        );
        setCatalog([]);
      });

    return () => {
      cancelled = true;
    };
  }, [getCatalog]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");

    if (checkout === "success" || checkout === "return") {
      setCheckoutStatus("success");
    } else if (
      checkout === "cancelled" ||
      checkout === "cancel"
    ) {
      setCheckoutStatus("cancelled");
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

  const redirect = async (
    key: string,
    getUrl: () => Promise<{ url: string }>,
  ) => {
    if (pending !== null) return;

    setPending(key);

    try {
      const { url } = await getUrl();

      if (!url || !/^https:\/\//i.test(url)) {
        throw new Error(
          "The billing service returned an invalid checkout URL.",
        );
      }

      window.location.assign(url);
    } catch (error) {
      toast.error(
        getErrorMessage(
          error,
          "Couldn't start billing. Please try again.",
        ),
      );

      setPending(null);
    }
  };

  if (summary === undefined || catalog === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Loading plans…
      </div>
    );
  }

  const plans = summary.plans ?? {};
  const current = summary.plan as PlanKey;
  const isPaid = current !== "free";

  const describe = (key: PlanKey): string[] => {
    const plan = plans[key];

    if (!plan) return [];

    const { limits } = plan;

    return [
      `${limits.aiMessages.toLocaleString()} AI messages per billing period`,
      `${limits.knowledgeFiles.toLocaleString()} knowledge-base files`,
      ...(key === "free" || limits.voice
        ? limits.voice
          ? ["Voice assistant"]
          : []
        : ["No voice assistant"]),
      `Up to ${limits.members} organization member${
        limits.members === 1 ? "" : "s"
      }`,
    ];
  };

  const getCatalogPlan = (
    key: PlanKey,
  ): CatalogPlan | undefined => {
    if (key === "free") return undefined;

    return catalog.find((item) => item.plan === key);
  };

  const missingPlans = PLAN_KEYS.filter((key) => !plans[key]);

  return (
    <div id="plans" className="space-y-6">
      {checkoutStatus === "success" && (
        <Alert>
          <SparklesIcon className="size-4" />
          <AlertTitle>
            Checkout completed : confirming your subscription
          </AlertTitle>
          <AlertDescription>
            Your paid features will appear after Polar confirms the
            subscription. You can continue using the dashboard while
            this is being processed.
          </AlertDescription>
        </Alert>
      )}

      {checkoutStatus === "cancelled" && (
        <Alert>
          <AlertTitle>Checkout cancelled</AlertTitle>
          <AlertDescription>
            No new subscription was confirmed. You can continue using
            your current plan or choose a paid plan whenever you are ready.
          </AlertDescription>
        </Alert>
      )}

      {catalogError && (
        <Alert variant="destructive">
          <AlertTitle>Pricing information unavailable</AlertTitle>
          <AlertDescription>{catalogError}</AlertDescription>
        </Alert>
      )}

      {missingPlans.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Some plan details are unavailable</AlertTitle>
          <AlertDescription>
            Missing plan data: {missingPlans.join(", ")}.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid w-full gap-6 md:grid-cols-3">
        {PLAN_KEYS.map((key) => {
          const plan = plans[key];
          const entry = getCatalogPlan(key);
          const isCurrent = key === current;
          const isFree = key === "free";
          const isHighlighted = key === "pro";
          const isEnterprise = key === "enterprise";

          const price =
            isFree
              ? "$0"
              : entry
                ? formatPrice(entry)
                : null;

          if (!plan) {
            return (
              <div
                key={key}
                className="flex min-h-[520px] flex-col rounded-xl border bg-card p-6"
              >
                <h3 className="text-xl font-semibold">
                  {PLAN_NAMES[key]}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Plan details are temporarily unavailable.
                </p>
              </div>
            );
          }

          return (
            <div
              key={key}
              className={cn(
                "group relative flex min-h-[520px] w-full flex-col rounded-xl border bg-card p-6",
                "transition-all duration-200 hover:-translate-y-1 hover:shadow-lg",
                isHighlighted && "shadow-md",
              )}
            >
              {isHighlighted && (
                <div className="absolute -top-3 left-6">
                  <Badge className="rounded-full px-3">
                    Most popular
                  </Badge>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold tracking-tight">
                    {plan.name}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isFree
                      ? "For individuals getting started"
                      : isHighlighted
                        ? "For growing teams and products"
                        : "For organizations with advanced needs"}
                  </p>
                </div>

                {isCurrent && (
                  <Badge variant="outline" className="shrink-0">
                    Current
                  </Badge>
                )}
              </div>

              <div className="mt-8">
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-semibold tracking-tight">
                    {price ??
                      (isEnterprise ? "Custom" : "Unavailable")}
                  </span>

                  {price && !isFree && entry?.interval && (
                    <span className="pb-1 text-sm text-muted-foreground">
                      / {entry.interval}
                    </span>
                  )}
                </div>

                {isEnterprise && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Built for larger teams and custom requirements.
                  </p>
                )}

                {isFree && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No credit card required.
                  </p>
                )}
              </div>

              <Separator className="my-6" />

              <div className="flex flex-1 flex-col">
                <ul className="space-y-4 text-sm">
                  {describe(key).map((feature) => {
                    const isVoiceFeature =
                      feature === "No voice assistant";

                    return (
                      <li
                        key={feature}
                        className="flex items-start gap-3"
                      >
                        <CheckIcon
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span
                          className={cn(
                            "leading-5",
                            isVoiceFeature &&
                              !isFree &&
                              "text-muted-foreground",
                          )}
                        >
                          {isVoiceFeature && !isFree
                            ? "Voice assistant: not included in this plan"
                            : feature}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-auto pt-10">
                  {isFree ? (
                    isCurrent ? (
                      <Button
                        className="w-full cursor-not-allowed"
                        variant="outline"
                        disabled
                      >
                        <CheckIcon className="mr-2 size-4" />
                        Current plan
                      </Button>
                    ) : (
                      <Button
                        className="w-full transition-all group-hover:shadow-md"
                        variant="outline"
                        onClick={() =>
                          window.location.assign("/dashboard")
                        }
                      >
                        Continue with Free
                        <ArrowRightIcon className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
                      </Button>
                    )
                  ) : isCurrent ? (
                    <Button
                      className="w-full transition-all group-hover:shadow-md"
                      variant="outline"
                      disabled={pending !== null}
                      onClick={() =>
                        redirect(
                          "portal",
                          () => createPortalSession({}),
                        )
                      }
                    >
                      {pending === "portal" ? (
                        <Loader2Icon className="mr-2 size-4 animate-spin" />
                      ) : null}
                      Manage subscription
                      {pending !== "portal" ? (
                        <ArrowRightIcon className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
                      ) : null}
                    </Button>
                  ) : isPaid ? (
                    <Button
                      className="w-full transition-all group-hover:shadow-md"
                      variant="outline"
                      disabled={pending !== null}
                      onClick={() =>
                        redirect(
                          "portal",
                          () => createPortalSession({}),
                        )
                      }
                    >
                      {pending === "portal" ? (
                        <Loader2Icon className="mr-2 size-4 animate-spin" />
                      ) : null}
                      Change plan
                      {pending !== "portal" ? (
                        <ArrowRightIcon className="ml-2 size-4" />
                      ) : null}
                    </Button>
                  ) : (
                    <Button
                      className={cn(
                        "w-full transition-all group-hover:shadow-md",
                        isHighlighted && "shadow-sm",
                      )}
                      variant={isHighlighted ? "default" : "outline"}
                      disabled={pending !== null}
                      onClick={() =>
                        redirect(
                          key,
                          () =>
                            createCheckout({
                              plan: key as PaidPlanKey,
                            }),
                        )
                      }
                    >
                      {pending === key ? (
                        <Loader2Icon className="mr-2 size-4 animate-spin" />
                      ) : null}
                      {pending === key
                        ? "Opening checkout..."
                        : isHighlighted
                          ? "Upgrade to Pro"
                          : "Choose Enterprise"}
                      {pending !== key ? (
                        <ArrowRightIcon className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
                      ) : null}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Need custom Enterprise limits or support? Contact us to discuss
        your requirements.
      </p>
    </div>
  );
};