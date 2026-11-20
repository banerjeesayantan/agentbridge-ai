# Unified Vercel deployment

AgentBridge is deployed as one Vercel project named `agentbridge-ai`, using the existing production domain:

- `https://agentbridge-ai-seven.vercel.app/` — dashboard (`apps/web`)
- `https://agentbridge-ai-seven.vercel.app/widget` — customer support widget (`apps/widget`)
- `https://agentbridge-ai-seven.vercel.app/embed/widget.js` — embeddable loader (`apps/embed`)

The service identifiers `web`, `widget`, and `embed` are internal deployment routing names. They are not separate Vercel projects or separate product names.

## Vercel project settings

In the existing `agentbridge-ai` project:

1. Keep the existing GitHub repository and production branch (`main`).
2. Set Framework Preset to **Services**.
3. Set Root Directory to the repository root (`./`).
4. Keep the existing project and production domain. Do not create separate Vercel projects for these apps.
5. Remove/clear project-level build, install, and output overrides if present; each service is built from its own app root and package scripts.
6. Keep the existing environment variables. Add the embed variables below and update the embed script URL as described.

The root `vercel.json` owns service roots and public routing. Do not set a project-wide Next.js build command or a project-wide output directory.

## Public routing

| Public path | Service | App root |
|---|---|---|
| `/` and dashboard routes | `web` | `apps/web` |
| `/widget` and `/widget/*` | `widget` | `apps/widget` |
| `/embed/*` | `embed` | `apps/embed` |

The widget uses Next.js `basePath: "/widget"`, because Vercel forwards the original request path to the selected service. Do not add a custom `assetPrefix`; Next.js basePath handles application links and static asset URLs.

The Vite library build writes the bundle to `dist/embed/widget.js`, matching the public `/embed/widget.js` route.

## Environment variables

Set these in the existing Vercel project's Production, Preview, and Development environments as appropriate:

| Variable | Value |
|---|---|
| `VITE_WIDGET_URL` | `https://agentbridge-ai-seven.vercel.app/widget` |
| `VITE_WIDGET_BOOTSTRAP_URL` | Full Convex HTTP deployment URL ending in `/widget/bootstrap` |
| `NEXT_PUBLIC_EMBED_SCRIPT_URL` | `https://agentbridge-ai-seven.vercel.app/embed/widget.js` |

The bootstrap endpoint is served by Convex, not by a Vercel service. Use the deployment's `.convex.site` origin and append `/widget/bootstrap`. Do not use the Convex `.cloud` URL for this HTTP action.

Existing Clerk, Convex, AI provider, billing, voice, and monitoring variables must be preserved. Do not copy secrets into source control.

## Deployment sequence

The first preview created during migration may still use the previous project framework setting. After changing the existing Vercel project framework to **Services**, create a fresh deployment from this branch so Vercel evaluates the `services` block. Confirm the build log shows all three service roots (`apps/web`, `apps/widget`, and `apps/embed`) before merging.

1. Merge the multi-service configuration PR after CI and preview checks pass.
2. Change the existing Vercel project's Framework Preset to **Services** and Root Directory to `./`.
3. Configure the three embed variables above in the existing project.
4. Trigger a production deployment from `main`.
5. Verify the dashboard, widget route, embed JavaScript response, and widget bootstrap flow before considering the migration complete.

## Verification

- `/` loads the dashboard.
- `/widget?organizationId=...` loads the widget application.
- `/widget/_next/static/*` assets load without 404s.
- `/embed/widget.js` returns the built IIFE bundle and registers `window.AgentBridgeWidget`.
- The embed script calls the Convex `/widget/bootstrap` endpoint and loads its iframe from `/widget`.
- Existing dashboard, authentication, API routes, and Convex-backed features continue to work.

Convex remains a separately hosted backend deployment. No Vercel service binding is needed for the current browser-to-Convex communication flow.
