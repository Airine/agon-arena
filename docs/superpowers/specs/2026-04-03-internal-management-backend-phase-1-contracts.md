# Internal Management Backend Phase 1 Contracts

Date: 2026-04-03  
Owner: worker-3  
Status: Ready for worker-1 / worker-2 integration

## Purpose

This file turns the approved internal backend design into a Phase 1 delivery contract.

It is intentionally narrower than the full design doc. The goal is to keep worker-1 and worker-2 aligned on what must ship now, what may exist behind the same auth boundary, and what stays out of scope until Phase 2.

Source design:
- `docs/superpowers/specs/2026-04-03-internal-management-backend-design.md`

Shared TypeScript contract source:
- `packages/types/src/internal.ts`

## Phase 1 Ship Boundary

Required page routes:
- `/internal`
- `/internal/alpha`
- `/internal/release-gate`

Required backend endpoints:
- `GET /internal/summary`
- `GET /internal/alpha-contacts`
- `GET /internal/alpha-contacts/:id`
- `PATCH /internal/alpha-contacts/:id`
- `GET /internal/release-gates`
- `PATCH /internal/release-gates/:id`

Optional Phase 1 backend endpoint:
- `GET /internal/funnel`
  - allowed only if worker-1 needs a standalone materialized-read-model endpoint early
  - not required for Phase 1 page parity because the Command Center can ship from `GET /internal/summary`

Explicitly out of scope for Phase 1:
- `/internal/arenas`
- `/internal/runtime`
- `/internal/settings`
- dangerous production mutations
- live Kafka reads from request handlers
- role-based internal authorization splits

## Contract Rules

1. Internal auth is staff-only and separate from product JWT auth.
2. Phase 1 page fetches should use the shared `@agon/types` contracts from `packages/types/src/internal.ts`.
3. Funnel data used by Phase 1 must come from a materialized source, not Kafka in the request path.
4. Alpha Pipeline and Release Gate are the only write surfaces in Phase 1.
5. Worker-1 and worker-2 may add implementation fields, but they should not remove or rename the shared contract fields without coordinating back through task 3 ownership.

## Response Shapes

### `GET /internal/summary`

Must include:
- `asOf`
- `activationOverview`
- `funnel`
- `blockerQueue`
- `releaseGate`
- `dataSources`

Why:
- lets worker-2 build Command Center without stitching multiple requests
- gives partial-data visibility for degraded upstream sources

### `GET /internal/alpha-contacts`

Must support the roster table shape:
- `displayName`
- `source`
- `ownerSubject`
- `ownerEmail`
- `status`
- `currentBlocker`
- `lastActivityAt`
- `nextFollowUpAt`
- `tags`

Recommended query params:
- `ownerSubject`
- `status`
- `search`
- `overdueOnly`
- `limit`
- `cursor`

### `GET /internal/alpha-contacts/:id`

Must extend the roster item with:
- `notes`
- `timeline`
- `latestFunnel`
- `latestArenaActivity`
- `latestRuntimeIssues`

This keeps the Phase 1 detail drawer self-contained.

### `PATCH /internal/alpha-contacts/:id`

Allowed mutations only:
- `ownerSubject`
- `ownerEmail`
- `status`
- `currentBlocker`
- `nextFollowUpAt`
- `notes`
- `tags`

No Phase 1 endpoint should mutate product identity, arena state, or runtime systems.

### `GET /internal/release-gates`

Must return:
- `id`
- `gateKey`
- `status`
- `note`
- `evidenceUrl`
- `updatedBySubject`
- `updatedByEmail`
- `updatedAt`

### `PATCH /internal/release-gates/:id`

Allowed mutations only:
- `status`
- `note`
- `evidenceUrl`

## Status Vocabulary

Alpha contact statuses are fixed in Phase 1:
- `new`
- `contacted`
- `installing`
- `smoke_passed`
- `competing`
- `first_action_submitted`
- `completed_arena`
- `blocked`
- `paused`
- `lost`

Release gate statuses are fixed in Phase 1:
- `unknown`
- `blocked`
- `at_risk`
- `ready`

## Scope Policing Notes

If implementation pressure appears, keep these guardrails:

- Do not let Phase 2 pages slip into the Phase 1 route shell just because navigation exists.
- Do not replace shared contract names independently on web and API sides.
- Do not couple Phase 1 Command Center rendering to deep-dive funnel or runtime pages.
- Do not add operationally dangerous write actions under `/internal/*`.
- Do not query Kafka directly from `/internal` request handlers.

## Verification Checklist For Integration

Worker-1 / worker-2 integration is ready when:

1. API handlers match the exported `@agon/types` internal contracts.
2. Web fetchers/pages consume those contract types without local drift.
3. Phase 1 nav only exposes the three required page routes.
4. No implementation introduces Phase 2 routes or dangerous writes under the Phase 1 banner.
