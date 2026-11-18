import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/backend";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { vapiWebhook } from "./vapiWebhookHttp";
import { assertOrgId } from "./lib/limits";
import { signWidgetInstallToken } from "./lib/widgetOrigin";
const http = httpRouter();

http.route({
  path: "/widget/bootstrap",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const requestUrl = new URL(request.url);
    const rawOrganizationId = requestUrl.searchParams.get("organizationId") ?? "";
    const origin = request.headers.get("origin");
    let organizationId: string;
    try {
      organizationId = assertOrgId(rawOrganizationId);
    } catch {
      return new Response("Invalid organization", { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (!origin || origin === "null" || origin.length > 255) {
      return new Response("A browser origin is required", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
      if (parsedOrigin.origin !== origin || (parsedOrigin.protocol !== "https:" && parsedOrigin.hostname !== "localhost" && parsedOrigin.hostname !== "127.0.0.1")) throw new Error("Invalid origin");
    } catch {
      return new Response("Invalid origin", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const config = await ctx.runQuery(internal.system.widgetInstallations.getConfig, { organizationId });
    if (!config || !config.allowedOrigins.includes(origin)) {
      return new Response("This website is not authorized to use this widget", { status: 403, headers: { "Cache-Control": "no-store" } });
    }

    const gate = await ctx.runMutation(internal.system.rateLimit.take, {
      key: `widget-bootstrap:${organizationId}:${origin}`,
      capacity: 30,
      refillPerSecond: 0.5,
    });
    if (!gate.ok) return new Response("Too many requests", { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, Math.ceil(gate.retryAfterMs / 1000))) } });

    const issuedAt = Date.now();
    let token: string;
    try {
      token = await signWidgetInstallToken({ organizationId, origin, issuedAt, expiresAt: issuedAt + 5 * 60_000 });
    } catch (error) {
      console.error("Widget installation token signing is not configured", error);
      return new Response("Widget authorization is unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
    }

    return new Response(JSON.stringify({ token, expiresAt: issuedAt + 5 * 60_000 }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
        "Vary": "Origin",
        "Cache-Control": "no-store, private",
        "Pragma": "no-cache",
      },
    });
  }),
});


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
  payloadString: string,
): Promise<WebhookEvent | null> {

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