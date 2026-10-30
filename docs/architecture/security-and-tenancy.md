# Security and Tenant Isolation

This document records the security rules for AgentBridge AI. It is a design and review checklist, not a certification that every control is already implemented.

## 1. Trust boundaries

| Surface | Trust level | Required validation |
|---|---|---|
| Dashboard browser | Untrusted | Clerk identity, organization membership, role/permission |
| Embedded widget | Public/untrusted | Widget configuration, origin policy where applicable, session validity, rate limits |
| Contact session | Bearer credential | Expiry, organization binding, conversation ownership |
| Convex public function | Public entry point | Validate every argument and authorize the requested resource |
| Convex private function | Authenticated entry point | Derive organization from verified identity; verify record ownership |
| Convex internal function | Server-only | Keep internal; validate invariants and caller assumptions |
| Polar webhook | External provider | Verify signature, timestamp/replay window and event idempotency |
| LLM output | Untrusted data | Validate structured output; never grant permissions based on model text |
| Uploaded files | Untrusted content | Size/type limits, safe extraction, tenant ownership and ingestion status |

## 2. Mandatory tenant rules

- Every organization-owned record must carry an organization identifier or be reachable only through a parent record whose organization is verified.
- Dashboard functions derive the organization ID from the verified Convex identity. Do not trust a client-supplied organization ID.
- Before reading or mutating a record by ID, verify that it belongs to the caller's organization.
- Public visitor functions must bind contact sessions to the organization and conversation. A guessed conversation ID must not grant access.
- RAG searches must always use the intended tenant namespace. Never fall back to a global namespace.
- File deletion, download URL generation and indexing must verify the file's organization ownership.
- Internal functions must not be exported through public API paths.

## 3. Roles and permissions

The product should distinguish at least:

- **Owner:** organization ownership and all organization settings.
- **Admin:** members, configuration, integrations, billing and data.
- **Operator:** customer conversations and permitted support actions.
- **Analyst:** read-only reporting and analytics.

Clerk authentication and organization membership do not automatically implement application-level RBAC. Enforce role checks in backend functions for sensitive operations; hiding a button in the UI is not authorization.

## 4. Public widget protections

- Treat organization IDs and widget identifiers as public identifiers, not secrets.
- Use short-lived, scoped visitor sessions.
- Validate session expiry and organization binding on every visitor operation.
- Apply per-origin, per-session and per-organization abuse controls where feasible.
- Bound message length, upload size, pagination and AI context size.
- Validate iframe message origin and source in the embed/widget communication path.
- Do not expose provider credentials, Polar credentials, AWS credentials or internal function names to the browser.

## 5. Webhook and billing protections

- Verify the provider signature against the raw request body.
- Enforce a bounded timestamp/replay window.
- Record provider event IDs for idempotency.
- Handle out-of-order events using provider modification timestamps where available.
- Grant paid access only from verified server-side subscription state.
- Keep plan limits and usage enforcement on the backend.
- Never delete customer content merely because a subscription downgrades.

## 6. AI safety

- Treat retrieved documents and customer messages as untrusted input.
- Retrieved content may provide facts but cannot override system policy or tool permissions.
- Expose only explicitly registered tools.
- Validate tool arguments and authorize the requested action in backend code.
- Do not allow model-generated organization IDs, user IDs or record IDs to bypass normal authorization.
- Apply bounded retries, timeouts and token limits.
- Escalate uncertain or unsupported requests instead of inventing company policy.

## 7. Release checklist

Before a production release, test:

- A member of organization A cannot read or modify organization B's records.
- A visitor session from organization A cannot access organization B's conversations.
- Expired sessions cannot read or write.
- Invalid, replayed and duplicate billing webhooks cannot grant or revoke incorrect access.
- Usage limits cannot be exceeded by concurrent requests.
- File operations reject cross-tenant IDs.
- Unauthorized roles cannot change billing, integrations or organization settings.
- Prompt injection in uploaded knowledge cannot invoke unauthorized tools.
- Secrets are absent from client bundles, logs and committed files.

## 8. Known verification work

The repository must be reviewed and tested against this checklist. A design document alone does not prove that a control is implemented.
