# AgentBridge AI

**AI-powered customer support for modern businesses.**

AgentBridge AI helps organizations support customers through an embeddable chat widget and AI assistant grounded in their own knowledge base, with human handoff when automation is not enough.

## Product capabilities

- Multi-organization workspace powered by Clerk organizations.
- Embeddable website chat widget and lightweight loader SDK.
- Customer conversations, operator inbox and human escalation.
- Knowledge-base uploads and organization-scoped retrieval-augmented generation (RAG).
- AI support agent with tool-based search, escalation and resolution.
- Voice support integration through Vapi.
- Subscription billing, plan entitlements and usage metering through Polar.
- Convex backend with public, private and internal function boundaries.

> This repository contains an evolving product implementation. See the roadmap and release checks before treating any feature as production-ready.

## Architecture

The project uses a **modular monolith**: Next.js applications share a Convex backend, with business capabilities separated into modules. This keeps development and operations manageable while leaving room to extract independently scalable services when evidence justifies it.

```text
agentbridge-ai/
├── apps/
│   ├── web/             # Organization dashboard
│   ├── widget/          # Customer-facing support widget
│   └── embed/           # Website embedding SDK
├── packages/
│   ├── backend/         # Convex schema, functions, AI, RAG and billing
│   ├── ui/              # Shared UI components
│   ├── math/            # Shared utilities
│   ├── eslint-config/
│   └── typescript-config/
└── docs/
    ├── architecture/
    └── billing-and-usage.md
```

### System design

- [Architecture overview](docs/architecture/overview.md)
- [Security and tenant isolation](docs/architecture/security-and-tenancy.md)
- [Implementation roadmap](docs/architecture/implementation-roadmap.md)
- [Billing and usage behavior](docs/billing-and-usage.md)

## Technology stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces, Turborepo |
| Dashboard and widget | Next.js 15, React, TypeScript |
| Authentication and organizations | Clerk |
| Backend and database | Convex |
| AI agent | `@convex-dev/agent`, Vercel AI SDK |
| Chat model | Groq |
| Embeddings and retrieval | OpenAI embeddings, Convex RAG |
| Voice | Vapi |
| Billing | Polar |
| UI | Tailwind CSS, shadcn/ui |
| Monitoring | Sentry |

## Getting started

### Prerequisites

- Node.js 20 or later
- pnpm 10.4.1 (the repository's package manager)
- Clerk application and organization configuration
- Convex deployment
- Groq API key for AI replies
- OpenAI API key for embeddings

Optional integrations require their own provider credentials (Polar, Vapi, AWS Secrets Manager and Sentry).

### Install

```bash
pnpm install --frozen-lockfile
```

### Configure environment

Configure the required variables in the relevant application and Convex deployment. Do not commit real credentials.

At minimum, review:

- Clerk publishable/secret keys and Convex JWT issuer domain.
- Convex deployment URL.
- Groq API key and optional chat model override.
- OpenAI API key for embedding generation.
- Polar credentials and product IDs when enabling billing.
- Vapi and AWS credentials only when enabling those integrations.

Use [billing and usage setup](docs/billing-and-usage.md) for the Polar webhook and Convex environment configuration.

### Run locally

Start the dashboard:

```bash
pnpm --filter web dev
```

Start the widget in another terminal:

```bash
pnpm --filter widget dev
```

Start the Convex development deployment in another terminal:

```bash
pnpm --filter @workspace/backend dev
```

The embed SDK is built separately:

```bash
pnpm --filter embed build
```

## Engineering principles

1. Organization-scoped authorization is enforced on the backend.
2. Public widget sessions are separate from staff authentication.
3. AI output and retrieved documents are untrusted input.
4. Billing entitlements and usage limits are server-authoritative.
5. Customer messages should be persisted before AI execution.
6. Add infrastructure only when a measured product or operational need requires it.

## Current development status

The repository has an existing implementation of the dashboard, widget, embed loader, Convex conversation backend, AI/RAG flow, knowledge files, voice integration and Polar billing.

The architecture documents describe current boundaries and the target evolution. Automated test coverage, security verification, deployment validation and production readiness remain explicit engineering work. Follow the [implementation roadmap](docs/architecture/implementation-roadmap.md) rather than assuming a module is complete because its UI exists.

## License

No open-source license has been added yet. All rights reserved unless a license is added by the repository owner.
