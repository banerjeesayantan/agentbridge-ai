import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/backend";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { vapiWebhook } from "./vapiWebhook";
const http = httpRouter();
http.route({
  path: "/vapi/webhook",
  method: "POST",
  handler: vapiWebhook,
});

http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    if (!process.env.CLERK_WEBHOOK_SECRET) {
      console.error("CLERK_WEBHOOK_SECRET is not configured.");
      return new Response("Webhook configuration error", {
        status: 500,
      });
    }

    const event = await validateRequest(request);

    if (!event) {
      return new Response("Invalid webhook signature or payload", {
        status: 400,
      });
    }

    // Subscriptions are managed by Polar, not Clerk Billing.
    console.log("Ignored Clerk webhook event", event.type);

    return new Response(null, { status: 200 });
  }),
});

http.route({
  path: "/polar/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Preserve the raw body for Standard Webhooks signature verification.
    const body = await request.text();

    try {
      const result = await ctx.runAction(
        internal.system.polarWebhook.handle,
        {
          body,
          headers: {
            // HTTP names stay hyphenated; Convex argument keys use camelCase.
            webhookId: request.headers.get("webhook-id") ?? "",
            webhookTimestamp:
              request.headers.get("webhook-timestamp") ?? "",
            webhookSignature:
              request.headers.get("webhook-signature") ?? "",
          },
        },
      );

      return new Response(null, { status: result.status });
    } catch (error) {
      console.error("Polar webhook handler failed", error);

      // Return a retryable server error for transient processing failures.
      return new Response("Webhook processing failed", { status: 500 });
    }
  }),
});

async function validateRequest(
  req: Request,
): Promise<WebhookEvent | null> {
  const secret = process.env.CLERK_WEBHOOK_SECRET;

  if (!secret) {
    console.error("CLERK_WEBHOOK_SECRET is not configured.");
    return null;
  }

  let payloadString: string;

  try {
    payloadString = await req.text();
  } catch (error) {
    console.error("Failed to read Clerk webhook body", error);
    return null;
  }

  const svixHeaders = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  try {
    const webhook = new Webhook(secret);

    return webhook.verify(
      payloadString,
      svixHeaders,
    ) as WebhookEvent;
  } catch (error) {
    console.error("Error verifying Clerk webhook event", error);
    return null;
  }
}

export default http;