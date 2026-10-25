import { createClerkClient } from "@clerk/backend";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { mapSubscriptionEvent } from "../lib/polarMapping";
import { verifyStandardWebhook } from "../lib/standardWebhooks";

export const handle = internalAction({
  args: {
    body: v.string(),
    headers: v.object({
      webhookId: v.string(),
      webhookTimestamp: v.string(),
      webhookSignature: v.string(),
    }),
  },

  handler: async (ctx, args): Promise<{ status: number }> => {
    const secret = env("POLAR_WEBHOOK_SECRET");

    if (!secret) {
      console.error(
        "POLAR_WEBHOOK_SECRET is not configured; refusing webhook.",
      );
      return { status: 500 };
    }

    const valid = await verifyStandardWebhook(
      args.body,
      {
        id: args.headers.webhookId,
        timestamp: args.headers.webhookTimestamp,
        signature: args.headers.webhookSignature,
      },
      secret,
    );

    if (!valid) {
      return { status: 403 };
    }

    let event: { type: string; data: unknown };

    try {
      event = JSON.parse(args.body);
    } catch {
      return { status: 400 };
    }

    if (typeof event?.type !== "string") {
      return { status: 400 };
    }

    if (!event.type.startsWith("subscription.")) {
      return { status: 200 };
    }

    const mapped = mapSubscriptionEvent(
      event.type,
      event.data,
      args.headers.webhookId,
      Date.now(),
    );

    if (!mapped) {
      console.warn(
        "Ignoring Polar subscription event without a linked organization",
        event.type,
      );
      return { status: 200 };
    }

    if (!mapped.plan) {
      console.warn(
        "Polar event for a product that is not mapped to a plan; it grants no paid access.",
        mapped.polarProductId,
      );
    }

    try {
      const result = await ctx.runMutation(
        internal.system.subscriptions.applyPolarEvent,
        {
          ...mapped,
          type: event.type,
        },
      );

      const clerkSecret = env("CLERK_SECRET_KEY");

      if (result.applied && clerkSecret) {
        try {
          const clerk = createClerkClient({
            secretKey: clerkSecret,
          });

          await clerk.organizations.updateOrganization(
            mapped.organizationId,
            {
              maxAllowedMemberships: result.memberCap,
            },
          );
        } catch (error) {
          console.error("Failed to update Clerk member cap", error);
        }
      }

      return { status: 200 };
    } catch (error) {
      console.error("Failed to apply Polar event", error);
      return { status: 500 };
    }
  },
});

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value : undefined;
}