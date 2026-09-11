# MallWork Phase 1 Legacy Protection and Documentation Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Preserve the complete pre-migration state of the legacy Pi-based MallWork repository, translate its reusable product and platform concepts into the new MallWork architecture, and produce an auditable roadmap without changing or interrupting the already-running MallWork application.

**Architecture:** The new MallWork repository remains the only future runtime and evolves into a centralized control plane. Independent commerce sites connect through a versioned Store Adapter contract. Phase 1 creates the preservation checkpoint and architecture/product documentation only; it does not migrate Pi runtime code, add application features, rebuild images, restart containers, or change environment configuration.

**Tech Stack:** Git, Markdown, PowerShell, Node.js/tsx for legacy offline verification, Docker Compose read-only inspection, existing React/FastAPI/AgentScope runtime.

**Spec:** `docs/superpowers/specs/2026-09-11-mallwork-ecosystem-migration-design.md`

## Global Constraints

- Preserve all existing data and every `.env` file; never overwrite, recreate, stage, or expose them.
- Do not modify application source, Dockerfiles, Compose configuration, volumes, images, or running containers in Phase 1.
- Do not restart, rebuild, recreate, stop, or remove any MallWork service.
- Do not push either repository or alter remotes.
- Do not delete or archive the legacy repository.
- In the legacy repository, stage only the explicitly listed files; never use `git add .`.
- Record verification failures faithfully. A failing legacy verification does not justify discarding uncommitted work.
- Documentation validation replaces test-driven development for this prose-only phase: use structural checks, cross-reference checks, repository status checks, and runtime health checks.
- Execute all Git commands with an explicit repository working directory to avoid crossing the two repositories.

---

## Task 1: Capture the Non-Disruption Baseline

**Repositories:**

- New runtime: `H:\Desktop\WorkPlace\Project\Cross_Big_Project\MallWork`
- Legacy source: `H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work`

- [x] Record the new repository branch, HEAD, remotes, and short status.

  Run:

  ```powershell
  git -C "H:\Desktop\WorkPlace\Project\Cross_Big_Project\MallWork" branch --show-current
  git -C "H:\Desktop\WorkPlace\Project\Cross_Big_Project\MallWork" rev-parse HEAD
  git -C "H:\Desktop\WorkPlace\Project\Cross_Big_Project\MallWork" remote -v
  git -C "H:\Desktop\WorkPlace\Project\Cross_Big_Project\MallWork" status --short
  ```

- [x] Record the legacy repository branch, HEAD, remotes, and exact dirty status.

  Run:

  ```powershell
  git -C "H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work" branch --show-current
  git -C "H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work" rev-parse HEAD
  git -C "H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work" remote -v
  git -C "H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work" status --short
  ```

- [x] Capture the running Compose service names, container IDs, image names, creation/start timestamps, health state, and published ports without mutating them.

  Run from the new repository:

  ```powershell
  docker compose ps --format json
  docker inspect mallwork-app-1 mallwork-frontend-1 mallwork-worker-1 mallwork-redis-1 mallwork-qdrant-1 --format '{{.Name}}|{{.Id}}|{{.Created}}|{{.State.StartedAt}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}'
  ```

- [x] Verify the public health endpoints and record their HTTP status/body.

  Run:

  ```powershell
  Invoke-WebRequest -UseBasicParsing http://localhost:8000/health
  Invoke-WebRequest -UseBasicParsing http://localhost:5173/health
  ```

**Acceptance:** The baseline identifies the exact repository and container state. No file, Git reference, container, image, volume, or environment variable has changed.

---

## Task 2: Verify the Legacy Skill Snapshot Offline

**Files to inspect:**

- `H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work\packages\mall-skills\test\verify-echo.ts`
- `H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work\packages\mall-skills\test\verify-zmall-client.ts`
- `H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work\packages\mall-skills\test\verify-ai-outfit.ts`
- `H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work\packages\mall-skills\test\verify-product-research.ts`
- `H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work\packages\mall-skills\test\verify-customer-service.ts`
- `H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work\packages\mall-skills\test\verify-role-routing.ts`
- `H:\Desktop\WorkPlace\Project\Cross_Big_Project\Mall work\packages\mall-skills\test\verify-integration.ts`

- [x] Confirm the local `tsx` entry point and TypeScript configuration exist. Do not install or upgrade dependencies unless verification cannot start because an already-declared package is missing.

- [x] Run every verification script explicitly from the legacy repository; do not substitute `npm test`.

  Command pattern, repeated for all seven scripts:

  ```powershell
  node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json packages/mall-skills/test/verify-echo.ts
  ```

- [x] Capture for each script: command, exit code, pass/fail, and a concise failure reason. Store the result later in `docs/migration/pi遗留资产迁移清单.md`.

- [x] If a test failure exposes a clear source defect, document it as legacy debt; do not fix runtime code in Phase 1.

**Acceptance:** All seven scripts were attempted. Their outcomes are traceable, and the legacy working tree contains no verification-generated changes.

---

## Task 3: Create the Legacy Local Preservation Checkpoint

**Files to checkpoint explicitly:**

- `README.md`
- `packages/mall-skills/src/index.ts`
- `packages/mall-skills/src/platform/adapters/zmall.ts`
- `packages/mall-skills/src/platform/types.ts`
- `packages/mall-skills/src/skills/zmall-client.ts`
- `packages/mall-skills/test/verify-integration.ts`
- `packages/mall-skills/test/verify-role-routing.ts`
- `packages/mall-skills/src/logger.ts`
- `packages/mall-skills/src/skills/ai-customer-service.ts`
- `packages/mall-skills/test/verify-customer-service.ts`

- [x] Re-run `git status --short` and confirm that the paths match this list. Stop if unexpected files appear until they are classified.

- [x] Stage only the ten listed paths with an explicit `git add -- <paths...>` command.

- [x] Review the staged summary and ensure no secrets, `.env`, generated artifacts, or unrelated paths are staged.

  Run:

  ```powershell
  git diff --cached --stat
  git diff --cached --name-status
  ```

- [x] Create the authorized local checkpoint commit.

  ```powershell
  git commit -m "feat(mall-skills): checkpoint pre-migration platform work"
  ```

- [x] Create the authorized annotated local tag.

  ```powershell
  git tag -a legacy-pi-pre-migration-20260911 -m "Legacy Pi MallWork checkpoint before control-plane migration"
  ```

- [x] Verify the commit, tag target, clean status, and unchanged remotes. Do not push.

  ```powershell
  git show --stat --oneline HEAD
  git show-ref --tags legacy-pi-pre-migration-20260911
  git tag -n legacy-pi-pre-migration-20260911
  git status --short
  git remote -v
  ```

**Acceptance:** The legacy work is recoverable from a local commit and annotated tag, the working tree is clean, and no remote operation occurred.

---

## Task 4: Write the Ecosystem Product Blueprint

**Create:** `docs/product/MallWork电商生态系统蓝图.md`

- [x] Add front matter with status, date, owners, scope, and link to the approved design spec.
- [x] Define the vision, target users, and explicit non-goals.
- [x] Define the two-level operating model:
  - Digital employees as bounded specialist agents.
  - Digital boss as goal, budget, KPI, workflow, approval, and review supervisor.
- [x] Define the first agent portfolio: consumer concierge, product research, inventory, pricing, SEO/content, and site builder.
- [x] Define the merchant and consumer value loops, human approval boundaries, safety expectations, and measurable KPIs.
- [x] State that the digital boss never writes commerce databases directly and that all store actions go through governed adapters.
- [x] State the product rollout order and what remains intentionally deferred.
- [x] Validate every material claim against the approved design spec.

**Acceptance:** The blueprint explains what MallWork is, for whom, how authority is bounded, and how success will be measured without claiming unimplemented capabilities.

---

## Task 5: Write the Control Plane Architecture

**Create:** `docs/architecture/中心控制面与站点接入架构.md`

- [x] Add a context diagram showing MallWork control plane, digital boss, specialist agents, approval/audit layer, Store Adapter boundary, and multiple independent stores.
- [x] Define control-plane modules: identity/tenant context, agent runtime, workflow/scheduler, policy/approval, adapter registry, event ingestion, observability, evaluation, and secrets boundary.
- [x] Define the per-store connector responsibility and explicitly separate it from core MallWork business logic.
- [x] Document synchronous commands, asynchronous operations, events/webhooks, correlation IDs, idempotency, and retry rules.
- [x] Document the trust model: least privilege, tenant/store isolation, credential ownership, secret rotation, audit trail, and no direct agent-to-database access.
- [x] Document deployment topology for the current single Compose environment and the later multi-store ecosystem without changing the current Compose file.
- [x] Include failure modes and recovery behavior for adapter outage, partial writes, stale inventory, rate limiting, duplicate events, and long-running jobs.
- [x] Include an architectural decision record section explaining why centralized control plane plus lightweight adapters was selected.

**Acceptance:** The architecture is implementable, preserves current runtime boundaries, and provides a clear extension point for ZMall and later platforms.

---

## Task 6: Define Store Adapter v1

**Create:** `docs/contracts/store-adapter-v1.md`

- [x] Define contract status, compatibility policy, semantic versioning rules, and capability negotiation.
- [x] Define required execution context fields:
  - `tenant_id`, `store_id`, `actor_id`, `actor_type`
  - roles/scopes
  - `correlation_id`, `request_id`, optional `idempotency_key`
- [x] Define capability groups and representative operations:
  - Catalog
  - Inventory
  - Pricing
  - Orders
  - Customers
  - Content/SEO
  - Marketing
  - Analytics
  - Deployment
- [x] Mark each operation as read/write, synchronous/asynchronous, approval-sensitive, and required/optional for conformance.
- [x] Define shared data rules: UTC timestamps, ISO currency, money in integer minor units, stable external IDs, cursor pagination, optimistic version fields, nullable-field semantics, and validation constraints.
- [x] Define write safety: idempotency keys, expected-version preconditions, dry-run where supported, confirmation tokens, and compensating-action metadata.
- [x] Define async operation handles and states: accepted, running, succeeded, failed, canceled, and expired.
- [x] Define event/webhook envelope, ordering assumptions, deduplication identifier, signature verification, replay window, and acknowledgement behavior.
- [x] Define normalized errors: `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `transient`, `validation`, and `unsupported`.
- [x] Define credential handling, secret redaction, timeouts, retries, circuit breaking, telemetry, and audit requirements.
- [x] Define v1 conformance tests and a ZMall reference adapter test matrix.

**Acceptance:** An adapter implementer can build a conforming connector without reading legacy Pi source, and dangerous writes have explicit safety semantics.

---

## Task 7: Build the Legacy Asset Inventory

**Create:** `docs/migration/pi遗留资产迁移清单.md`

- [x] Record the legacy repository path, branch, pre-checkpoint HEAD, checkpoint commit, tag, remotes, checkpoint time, and explicit “not pushed” status.
- [x] Record all ten checkpointed files with tracked/untracked origin, SHA-256 hash captured before checkpoint, purpose, dependencies, verification result, migration disposition, and target phase.
- [x] Inventory reusable committed materials under:
  - `packages/mall-skills/src/platform/`
  - `packages/mall-skills/src/skills/`
  - `packages/mall-skills/test/`
  - `openspec/changes/general-agent-workbench/`
- [x] Classify every asset as one of:
  - concept/specification to rewrite
  - test scenario to port
  - adapter behavior to reimplement
  - obsolete Pi runtime coupling
  - historical/reference only
- [x] Record all seven verification commands and outcomes from Task 2.
- [x] State the deletion gate exactly: local checkpoint/tag, private remote backup, complete mapping, target features implemented and verified, and explicit user deletion authorization.

**Acceptance:** Every uncommitted legacy asset is accounted for by immutable hash and migration disposition; no asset is silently dropped.

---

## Task 8: Map Every Legacy OpenSpec Requirement

**Create:** `docs/migration/pi-openspec需求映射.md`

**Source specifications:**

- `openspec/changes/general-agent-workbench/specs/agent-autonomy-platform/spec.md`
- `openspec/changes/general-agent-workbench/specs/product-recommendation/spec.md`
- `openspec/changes/general-agent-workbench/specs/merchant-operations/spec.md`
- `openspec/changes/general-agent-workbench/specs/merchant-monitoring/spec.md`
- `openspec/changes/general-agent-workbench/specs/merchant-creative/spec.md`

- [x] Extract every requirement and scenario from all five source specs.
- [x] Assign each a stable mapping ID and record source file/heading.
- [x] Map it to the new control-plane component, responsible agent, Store Adapter capability, current implementation status, target phase, validation method, and notes.
- [x] Use only evidence-based status values: existing, partial, planned, rejected, or superseded.
- [x] Explicitly call out Pi-specific assumptions that are superseded by FastAPI/AgentScope, Redis worker queues, Qdrant, and the browser UI.
- [x] Cross-check the count of mapped requirements/scenarios against the source headings so none are omitted.

**Acceptance:** All legacy OpenSpec requirements and scenarios have an explicit future home or documented rejection, with no false “implemented” claims.

---

## Task 9: Publish the Phased Roadmap

**Create:** `docs/roadmap/MallWork分阶段实施路线图.md`

- [x] Define phases and dependencies:
  1. Legacy protection and documentation migration.
  2. Tenant/store identity and authorization foundation.
  3. Store Adapter v1 runtime and contract-test harness.
  4. ZMall reference adapter and consumer capabilities.
  5. Digital boss autonomy runtime and persistent workflow scheduling.
  6. Merchant operations, monitoring, and creative agents.
  7. Standard site/SDK and governed deployment pipeline.
  8. Second-platform adapter and ecosystem conformance proof.
  9. Legacy archive/deletion decision.
- [x] For each phase define goals, prerequisites, deliverables, risks, tests, data migration impact, rollback strategy, and exit criteria.
- [x] Add a dependency graph and critical path.
- [x] Identify decisions deferred until evidence exists, especially identity provider, production database, secret manager, scheduler, and deployment provider.
- [x] State that Phase 9 cannot delete the legacy repository without a fresh explicit user authorization.

**Acceptance:** Each phase has testable exit criteria and a rollback boundary; future agents can execute without inventing the migration sequence.

---

## Task 10: Cross-Document Audit and Coherent Commits

- [x] Validate required files and headings with `Test-Path`, `rg --files docs`, and `rg` heading searches.
- [x] Scan new documents for placeholders and unresolved language:

  ```powershell
  rg -n "TODO|TBD|FIXME|待定|待补|占位" docs/product docs/architecture docs/contracts docs/migration docs/roadmap
  ```

- [x] Verify terminology is consistent: MallWork product/repository, “Mall Work” only as the display name where intentional, control plane, digital boss, digital employee, Store Adapter, tenant, store, and ZMall.
- [x] Verify internal links resolve and every roadmap phase referenced by inventory/mapping exists.
- [x] Verify only documentation files changed in the new repository before every commit.
- [x] Create coherent commits with explicit staging, for example:
  - `docs: add MallWork ecosystem blueprint`
  - `docs: define store adapter v1 contract`
  - `docs: map pi legacy assets and requirements`
  - `docs: add phased MallWork ecosystem roadmap`
- [x] Never stage `.env`, runtime data, application source, Compose files, or unrelated user changes.

**Acceptance:** Documentation is internally consistent, placeholder-free, traceable to the approved spec, and committed without unrelated changes.

---

## Task 11: Prove Phase 1 Did Not Affect MallWork Runtime

- [x] Re-run the API and frontend health checks from Task 1.
- [x] Re-run Compose and container inspection from Task 1.
- [x] Compare each service’s container ID, creation timestamp, and start timestamp with the baseline; all must be unchanged.
- [x] Confirm the five expected services remain running and Redis remains healthy.
- [x] Confirm the new repository diff/history for this phase contains documentation only and the working tree is clean.
- [x] Confirm the legacy repository is clean at the checkpoint tag and remotes are unchanged.
- [x] Confirm no push was performed and no remote branch/tag was created by this task.
- [x] Summarize verification results, local checkpoint/tag, documents created, known legacy test failures, and unchanged access addresses.

**Acceptance:** MallWork remains accessible at its existing addresses, its containers were not recreated or restarted, its data/configuration is untouched, and the legacy work is locally recoverable and fully mapped.

