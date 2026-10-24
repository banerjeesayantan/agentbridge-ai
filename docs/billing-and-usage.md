# Billing, entitlements and usage (Polar)

## How it works
- **Plans** live in one place: `packages/backend/convex/lib/entitlements.ts` (`PLANS`). The UI renders what `api.private.usage.summary` returns; it never decides limits itself.
- **Quotas are proposed defaults**, edit them there. Prices are *not* in the repo: the billing page reads them from your real Polar products.
- **Polar is the source of truth.** Checkout is created server-side (`private/billing.ts`) for an allowlisted plan, tied to the Clerk organization via `externalCustomerId`. Paid access is granted only by a **signature-verified webhook** (`/polar/webhook` -> `system/polarWebhook.ts`). Polar is called over its documented REST API (`lib/polarApi.ts`) and webhooks are verified per the Standard Webhooks spec Polar signs with (`lib/standardWebhooks.ts`: HMAC-SHA256 over `id.timestamp.body`, 5-minute replay window). No Polar SDK is used, so there is no SDK version to track. Returning from checkout grants nothing.
- **Webhooks are idempotent**: duplicate deliveries (`webhook-id`) are ignored, older events (by Polar `modified_at`) are ignored, and an end-event for a different subscription cannot downgrade a live one.
- **Policy** (`resolveEntitlements`): no/unknown/unverified subscription -> Free. `active`/`trialing` -> plan. `past_due` -> plan for 7 days from first failure, then Free. `canceled`/`revoked`/`unpaid`/`incomplete*` -> Free. `cancel_at_period_end` keeps the plan until the period ends. If no event arrives for 3 days after a period ended, fall back to Free. **No data is ever deleted** on downgrade.
- **Metering**: `system/usage.consume` is a Convex mutation (serialized, so concurrent requests can't overshoot). Counters are per organization + period in the database. Free period = UTC calendar month; paid period = Polar's billing period (an upgrade starts a fresh allowance). Over the limit, customer messages are **saved and escalated to a human**, never dropped, and no model call is made.
- **Metered today**: AI replies (widget) and AI message enhancement (operators). **Limited today**: knowledge-base file count (checked before upload; best-effort under simultaneous uploads), voice (plan flag, enforced when saving the Vapi key). Nothing else is metered because nothing else is supported.

## One-time setup (cannot be done from code)
1. In Polar (start with **sandbox**): create an organization, two recurring products (Pro, Business), an **organization access token**, and a **webhook** pointing to `https://<your-convex-deployment>.convex.site/polar/webhook` with subscription events enabled. Copy the webhook secret.
2. Convex dashboard -> Environment Variables:
   | Variable | Value |
   |---|---|
   | `POLAR_ACCESS_TOKEN` | Polar organization access token |
   | `POLAR_SERVER` | `sandbox` (use `production` later) |
   | `POLAR_WEBHOOK_SECRET` | Polar webhook secret |
   | `POLAR_PRODUCT_PRO_ID` / `POLAR_PRODUCT_BUSINESS_ID` | the product IDs from Polar |
   | `APP_URL` | your dashboard URL, e.g. `https://app.example.com` |
   | `GROQ_API_KEY`, `OPENAI_API_KEY` | AI replies / embeddings (already required) |
   | `GROQ_CHAT_MODEL`, `GROQ_VISION_MODEL` | optional model overrides (defaults `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`) |
   | `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` | existing |
3. Clerk: leave Billing **off**. The Clerk JWT template `convex` should include `org_id` (already used) and ideally `org_role` so billing actions are restricted to org admins (without the claim the admin check cannot be applied).
4. `pnpm install` then `pnpm --filter @workspace/backend dev` once, to regenerate `convex/_generated/*` (new modules: `lib/*`, `private/billing`, `private/usage`, `system/usage`, `system/polarWebhook`) and push the schema.
5. `apps/widget/public/widget.js` was replaced with a fresh build of the fixed `embed.ts` (widget URL unchanged: `https://next15-echo-widget.vercel.app`). To use your own deployment, set `VITE_WIDGET_URL`, run `pnpm --filter embed build`, copy `dist/widget.js` over it, and set `NEXT_PUBLIC_EMBED_SCRIPT_URL` in the web app.
6. **AI models**: Groq retired `llama-3.3-70b-versatile` on 2026-08-16 (and the llama-3.2 vision previews in 2025), so the old code was calling dead models. Defaults now follow Groq's recommended replacements; confirm `GROQ_VISION_MODEL` in the Groq console (image uploads only). Note: PDF extraction sends a PDF *file part* to a text model; Groq may not accept that, so test a PDF upload.

## Test checklist (sandbox)
Free org: upload 5 files, 6th fails with a clear message; send 100 widget messages, 101st is saved + escalated. Upgrade with a Polar sandbox card (`4242 4242 4242 4242`): plan flips only after the webhook. Replay the same webhook: no change. Cancel in the portal: plan stays until period end. Second organization cannot see the first's conversations/files.
