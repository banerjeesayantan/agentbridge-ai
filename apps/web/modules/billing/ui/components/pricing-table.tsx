"use client";

const plans = [
  {
    name: "Free",
    price: "$0",
    description: "For trying AgentBridge AI.",
    features: ["Basic access", "Limited usage"],
  },
  {
    name: "Pro",
    price: "See pricing",
    description: "For growing teams.",
    features: ["Higher usage limits", "Advanced features"],
  },
];

export const PricingTable = () => {
  return (
    <div className="grid w-full max-w-4xl gap-6 md:grid-cols-2">
      {plans.map((plan) => (
        <div
          key={plan.name}
          className="rounded-lg border p-6"
        >
          <h2 className="text-xl font-semibold">{plan.name}</h2>
          <p className="mt-2 text-2xl font-bold">{plan.price}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {plan.description}
          </p>

          <ul className="mt-4 space-y-2">
            {plan.features.map((feature) => (
              <li key={feature} className="text-sm">
                {feature}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};