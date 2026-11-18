import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/backend";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { vapiWebhook } from "./vapiWebhookHttp";
const http = httpRouter();
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

async function readLimitedBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payloadString = await readLimitedBody(request, MAX_WEBHOOK_BODY_BYTES);
    if (payloadString === null) return new Response("Payload too large", { status: 413 });
    const event = await validateRequest(request, payloadString);

    if (!event) {
      return new Response("Error occurred", { status: 400 });
    }

    // Keep the organization mirror in sync. Subscriptions are managed by Polar,
    // not Clerk Billing, so other events are ignored.
    switch (event.type) {
      case "organization.created":
      case "organization.updated":
        await ctx.runMutation(internal.system.organizations.upsert, {
          clerkOrgId: event.data.id,
          name: event.data.name,
        });
        break;
      case "organization.deleted":
        if (event.data.id) {
          await ctx.runMutation(internal.system.organizations.markDeleted, { clerkOrgId: event.data.id });
        }
        break;
      default:
        break;
    }

    return new Response(null, { status: 200 });
  }),
});

http.route({
  path: "/polar/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readLimitedBody(request, MAX_WEBHOOK_BODY_BYTES);
    if (body === null) return new Response("Payload too large", { status: 413 });

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

http.route({
  path: "/vapi/webhook",
  method: "POST",
  handler: vapiWebhook,
});
export default http;