# AgentBridge AI — Implementation Roadmap

The roadmap is ordered by dependency and risk. Existing functionality should be audited and retained; do not rebuild a working module just to match a new folder diagram.

## Phase 0 — Baseline and engineering safety

- [ ] Record the current main commit and establish a feature branch.
- [ ] Verify install, build, lint and typecheck commands for every workspace.
- [ ] Add a supported automated test runner and CI workflow.
- [ ] Add unit tests for entitlement policy, billing event mapping and usage-period calculations.
- [ ] Add a safe environment-variable template and validate required server variables at startup.
- [ ] Review dependency and secret hygiene.
- [ ] Document local setup and deployment prerequisites.

**Exit criteria:** a clean checkout can install dependencies, run checks and execute automated tests in CI.

## Phase 1 — Tenant security and backend contracts

- [ ] Inventory all public, private and internal Convex functions.
- [ ] Verify organization ownership checks for every private query/mutation/action.
- [ ] Verify visitor session and conversation ownership checks for every public widget function.
- [ ] Add centralized role/permission checks for sensitive staff actions.
- [ ] Verify RAG namespace and file ownership isolation.
- [ ] Add request bounds, abuse protection and safe error responses.
- [ ] Document function contracts and error codes.

**Exit criteria:** cross-tenant and role-based authorization tests pass.

## Phase 2 — Customer support lifecycle

- [ ] Verify widget initialization and customer session lifecycle.
- [ ] Verify conversation creation, pagination and message persistence.
- [ ] Verify AI replies and message streaming/refresh behavior.
- [ ] Verify escalation, operator reply and resolution state transitions.
- [ ] Add retry-safe request IDs and idempotency where needed.
- [ ] Improve loading, empty, offline and provider-error states.

**Exit criteria:** a customer can start a conversation, receive an answer, reach a human and see the final resolution.

## Phase 3 — Knowledge and AI reliability

- [ ] Verify upload limits and supported formats.
- [ ] Add ingestion lifecycle states and retry handling.
- [ ] Test chunking, embeddings, retrieval relevance and tenant isolation.
- [ ] Add a small evaluation dataset for answer grounding.
- [ ] Add model timeouts, bounded retries and provider fallback policy.
- [ ] Track model, token, latency, error and cost metadata.
- [ ] Protect tools with explicit permissions and input validation.

**Exit criteria:** grounded answers are measurable, failures are recoverable and tenant data remains isolated.

## Phase 4 — SaaS operations

- [ ] Test checkout, webhook signature verification and idempotency.
- [ ] Test upgrades, cancellations, past-due grace periods and downgrades.
- [ ] Verify usage accounting under concurrent requests and retries.
- [ ] Add audit events for sensitive organization actions.
- [ ] Add operational dashboards and alerting.
- [ ] Verify backup, recovery and deployment rollback procedures.

**Exit criteria:** subscription and usage behavior is reliable and supportable.

## Phase 5 — Product expansion

- [ ] Add richer analytics and conversation reporting.
- [ ] Improve configurable agent behavior and prompt versioning.
- [ ] Expand supported integrations and channels.
- [ ] Mature voice support and its usage policy.
- [ ] Add enterprise controls based on customer demand.

## Phase 6 — Scale only when justified

Potential additions include a dedicated ingestion worker, queue, cache, separate AI execution service or independent deployment boundaries. Introduce each only when load tests, reliability requirements or operational constraints justify it.

## Working agreement

For every implementation slice:

1. Inspect the existing implementation and its callers.
2. Make the smallest coherent change.
3. Add or update tests.
4. Run relevant checks.
5. Review the diff for secrets, tenant leaks and regressions.
6. Commit with a clear message and push the feature branch.
7. Merge only after checks pass.

Never report a feature as complete merely because files or UI controls exist.
