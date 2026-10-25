import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/backend";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const event = await validateRequest(request);

    if (!event) {
      return new Response("Error occurred", { status: 400 });
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
    const body = await request.text();

    const result = await ctx.runAction(
      internal.system.polarWebhook.handle,
      {
        body,
        headers: {
          webhookId: request.headers.get("webhook-id") ?? "",
          webhookTimestamp:
            request.headers.get("webhook-timestamp") ?? "",
          webhookSignature:
            request.headers.get("webhook-signature") ?? "",
        },
      },
    );

    return new Response(null, { status: result.status });
  }),
});

async function validateRequest(
  req: Request,
): Promise<WebhookEvent | null> {
  const payloadString = await req.text();

  const svixHeaders = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  const secret = process.env.CLERK_WEBHOOK_SECRET;

  if (!secret) {
    console.error("CLERK_WEBHOOK_SECRET is not configured.");
    return null;
  }

  const webhook = new Webhook(secret);

  try {
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