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

## Feedback (Phase 4)
Customers rate each AI answer (thumbs up/down + optional comment) in the widget. Ratings are stored per organization (`feedback` table, one rating per message, re-rating replaces it) and shown at `/feedback`: positive/negative share and recent items (Free: counts + last 5 ratings; Pro and above: comments, last 50, CSV export, enforced in the backend). Not built: a "neutral" bucket (the widget only offers up/down) and "most common issues" (needs topic classification, which this version deliberately doesn't attempt).

## Free embeddings (Phases 10-11)
Set `EMBEDDING_PROVIDER=google` and `GOOGLE_GENERATIVE_AI_API_KEY` (free Gemini API key) in Convex env to use `gemini-embedding-001` at 1536 dimensions, matching the existing index. Default stays OpenAI so nothing breaks. **Re-upload all knowledge files after switching.** A fully local model is not a good fit for Convex cloud (no local runtime or persistent model cache); it would need a separate embedding service you host (e.g. Ollama) reachable from Convex, which is a larger change not made here. Free-tier terms (rate limits, whether free-tier data may be used by Google) should be checked against Google's current terms before using real customer documents.

## Demo script
Free org -> upload docs at Knowledge Base -> ask the widget in the Playground a product question (answer comes from your docs) -> ask something unrelated (it declines and offers a human) -> thumbs up/down an answer -> see it at Feedback -> watch AI messages and files fill on the main page -> hit a limit (upload wall / AI hands over to a human) -> Billing -> Upgrade -> Polar sandbox checkout -> plan flips to Pro only after the webhook.

---

## Free-plan voice demo (one trial, budget-capped)

Free organizations get **one successful voice trial, ever**. Paid plans that include voice keep using the organization's own Vapi setup (Voice Assistant page → AWS-stored keys), which costs the developer nothing.

### How it works
1. The widget calls `public.voiceDemo.start` with its contact session. The server checks: valid session → real Clerk organization → plan → trial not used → attempt cap → capacity.
2. Capacity is **reserved atomically** (Convex mutations are serialized) against a per-provider budget and a global budget. No capacity ⇒ the call is refused and nothing starts.
3. The widget starts the call through a provider adapter (`apps/widget/modules/widget/voice/`). If the provider fails **before** the call connects, the server releases that reservation and moves to the next eligible provider. A connected call is never switched.
4. The trial is consumed only when the session **succeeds**: connected, ≥ `VOICE_DEMO_MIN_SUCCESS_SECONDS` (server-measured, default 20s), ≥ `VOICE_DEMO_MIN_USER_TURNS` visitor turns (default 1), no provider error. A start attempt alone never consumes it.
5. Budget is charged from **server-measured** time, capped at the reservation. A call that connects but is never reported is charged in full and counts as an attempt (cap: `VOICE_DEMO_MAX_ATTEMPTS_PER_ORG`, default 5) but does not consume the trial.
6. A cron (`convex/crons.ts`, every 5 minutes) releases abandoned reservations.

### Configuration: set in the **Convex dashboard → Settings → Environment Variables** (server-side)
| Variable | Required | Purpose |
|---|---|---|
| `VOICE_DEMO_ENABLED` | yes | must be exactly `true`; otherwise the demo is off |
| `VOICE_DEMO_GLOBAL_BUDGET_SECONDS` | yes | hard cap across all providers. **Unset = 0 = deny** |
| `VOICE_DEMO_VAPI_BUDGET_SECONDS` | yes | cap for Vapi. **Unset = 0 = deny** |
| `VAPI_DEMO_PUBLIC_KEY` | yes | the developer's Vapi **public** key (browser-safe by design) |
| `VAPI_DEMO_ASSISTANT_ID` | yes | the demo assistant. Set `maxDurationSeconds` on it ≤ `VOICE_DEMO_MAX_SESSION_SECONDS` |
| `CLERK_SECRET_KEY` | yes (already used) | verifies the organization exists; missing ⇒ deny |
| `VOICE_DEMO_PROVIDER_ORDER` | no | default `vapi`; unknown names are ignored |
| `VOICE_DEMO_MAX_SESSION_SECONDS` | no | default 180 |
| `VOICE_DEMO_MIN_SUCCESS_SECONDS` / `VOICE_DEMO_MIN_USER_TURNS` | no | success criteria, defaults 20 / 1 |
| `VOICE_DEMO_MAX_ATTEMPTS_PER_ORG` / `VOICE_DEMO_MAX_FALLBACKS` | no | defaults 5 / 2 |
| `VOICE_DEMO_BUDGET_PERIOD` | no | `total` (default, lifetime) or `monthly` |

No private provider key is needed by this design: the browser Vapi SDK uses only the public key. Do **not** put any of these in `NEXT_PUBLIC_*` variables. The existing tenant flow still uses `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (Convex env) with permissions `secretsmanager:CreateSecret`, `PutSecretValue`, `GetSecretValue` on `tenant/*`.

### Honest limits
- **Budgets are configured numbers, not provider balances.** Set them below what you are willing to spend. Vapi has no hard free tier I could verify; check your Vapi account's credits and billing before enabling, and keep auto-recharge off.
- A Vapi public key can start calls on its assistant from anywhere. Our quota governs the widget path only. In the Vapi dashboard restrict the key's allowed origins and cap the assistant's `maxDurationSeconds`.
- Only **Vapi** has an adapter. LiveKit, ElevenLabs etc. are intentionally not added: none was verified for free-tier terms or API compatibility here. Adding one = a new adapter in `voice/` + a server-side entry in `lib/voiceDemo.ts` (`IMPLEMENTED_PROVIDERS`, config, budget).
- Paid-plan **voice-minute limits are not implemented** (voice is a yes/no plan feature; paid usage runs on the tenant's own Vapi account).
- Attackers could create many real Clerk organizations to claim many trials; the global budget is the backstop.
