# Internal Management Backend Design

Date: 2026-04-03  
Branch: `master`  
Status: Draft approved for planning

## Summary

Build an internal-only management backend at `/internal` inside `apps/web`.

The backend is for one audience boundary, internal Singularity users authenticated by `sso.singularity-x.ai`. Everyone who gets through SSO sees the same product and the same capabilities. No role split in v1.

This is not a generic admin panel. It is an operations console for one problem: proving and managing external agent activation. It ties together people, funnel progression, runtime health, and release readiness in one place.

## Problem

The repo can already emit the right signals:
- agent funnel events
- runtime and trace data
- sandbox arena data
- release gate inputs

But the team still cannot answer basic questions quickly:
- Which external alpha users are active right now?
- Where are they dropping in the activation funnel?
- Is a low conversion number caused by user friction or by a runtime/system problem?
- Are we actually ready to unblock the next release gate?

Today that truth is fragmented across logs, Kafka topics, docs, arena pages, and human memory.

## Goals

1. Create one internal source of truth for activation.
2. Give core team, ops, and engineering the same top-level view before they drill into their details.
3. Support lightweight business operations directly in the tool:
   - alpha status changes
   - owner assignment
   - follow-up scheduling
   - release gate notes and status
4. Keep the first version safe:
   - internal only
   - business operations only
   - no dangerous infrastructure actions

## Non-Goals

1. Public-facing admin or owner-facing analytics.
2. A full observability replacement for infrastructure tooling.
3. A generic CRM.
4. A full BI warehouse or dashboard stack.
5. Fine-grained role-based permissions in v1.
6. Dangerous controls like restarting services, replaying queues, mutating production arena state, or deleting user data.

## Users

Three user types share the same console:

1. Core team
   - needs top-line activation truth
   - needs release gate visibility

2. Ops / BD
   - needs alpha roster management
   - needs follow-up tracking and blocker visibility

3. Engineering
   - needs runtime health, traces, and system correlation

Important: these are not separate products. They are different views into the same system state.

## Chosen Approach

Use a shared overview plus business-domain pages.

Route:
- `/internal`

Placement:
- inside existing `apps/web`

Why this approach:
- reuses the existing web shell, styling primitives, and deployment path
- keeps the internal tool close to the system it observes
- avoids building three fragmented role dashboards
- allows one shared homepage and clear drill-down pages

Rejected approaches:
- separate dashboards per role
  - duplicates information and splits truth
- standalone front-end app
  - adds deployment and auth complexity too early

## Authentication and Access

### Authentication

Authentication is handled by `sso.singularity-x.ai`.

The internal frontend should treat SSO as the only valid entry path. Users reaching `/internal` without a valid internal SSO session are redirected into the SSO flow.

### Authorization

Version 1 has one permission bucket:
- authenticated internal user = full internal access

No `viewer / operator / admin` split in v1.

### Security posture

The internal backend must still enforce access on the API side. The UI hiding a page is not enough.

Required rule:
- every `/internal/*` API route validates internal SSO-backed identity server-side before returning data or accepting writes

## Information Architecture

Top navigation:

1. `Command Center`
2. `Alpha Pipeline`
3. `Funnel`
4. `Arena Ops`
5. `Runtime Health`
6. `Release Gate`
7. `Settings`

This matches the approved “shared truth first, domain drill-down second” structure.

## Page Design

### 1. Command Center

Purpose:
- one-screen operational truth for the whole team

This page is mixed-density, not maximal-density. It should feel like a daily command view, not a wall of metrics.

Module order:

1. Activation Overview
2. Funnel Summary
3. Alpha Blocker Queue
4. Runtime Red Zone
5. Release Gate

#### Activation Overview

Shows:
- new agents today / 7d
- `first_action_submitted` today / 7d
- completed arenas today / 7d
- top-line trend vs prior period
- current largest activation blocker label

Why it exists:
- answer “are we healthier or worse than last week?” in under 10 seconds

#### Funnel Summary

Shows:
- stage counts for:
  - `wallet_connected`
  - `session_created`
  - `arena_joined`
  - `first_turn_received`
  - `first_action_submitted`
  - `arena_finished` when available
- conversion rate from previous stage
- largest drop-off stage

Why it exists:
- answer “where are we losing people?” without leaving the home screen

#### Alpha Blocker Queue

Shows:
- alphas stuck > 24h
- alphas with follow-up overdue
- alphas that progressed recently but have no owner note

Why it exists:
- operational urgency queue

#### Runtime Red Zone

Shows:
- current or recent spikes in:
  - join failures
  - first-turn-to-first-action failures
  - trace volume
  - runtime/socket auth failures

Why it exists:
- separate human friction from system breakage

#### Release Gate

Shows:
- current gate verdict
- unmet conditions
- links to evidence

Why it exists:
- keep release readiness visible without opening a dedicated page

### 2. Alpha Pipeline

Purpose:
- editable operating table for the external alpha roster

Main view:
- searchable/filterable table

Columns:
- display name
- source
- owner
- current status
- current blocker
- last activity
- next follow-up
- tags

Side panel / detail drawer:
- timeline of state changes and notes
- latest funnel stage
- latest arena activity
- latest runtime issues if any

Editable fields in v1:
- owner
- status
- blocker
- next follow-up timestamp
- notes
- tags

This page is the main write surface in v1.

### 3. Funnel

Purpose:
- explain conversion structure, not just totals

Views:
- main funnel
- trend over time
- breakdown by source
- breakdown by framework
- breakdown by arena type
- stuck-agent list

The stuck-agent list should show agents that reached one stage but did not reach the next within a chosen time window.

### 4. Arena Ops

Purpose:
- connect activation to live arena behavior

Shows:
- waiting arenas
- running arenas
- recently finished arenas
- sandbox usage
- anomalous arenas

An anomalous arena is one with signals like:
- repeated join attempts but no start
- repeated `first_turn_received` without `first_action_submitted`
- high timeout or trace volume

### 5. Runtime Health

Purpose:
- engineering-first health view focused on activation-critical runtime paths

Shows:
- API health snapshot
- Kafka funnel topic health
- runtime/socket auth failures
- trace counts by type
- recent trace samples
- latency distributions for:
  - arena join
  - first turn received
  - first action submitted

This page should not try to replace infrastructure monitoring. It should focus only on the system paths that affect activation.

### 6. Release Gate

Purpose:
- explicit publish/no-publish decision surface

Shows:
- gate checklist
- current status per gate
- evidence links
- notes
- last updated by / last updated at

Editable fields:
- gate status
- note
- evidence URL or evidence reference

### 7. Settings

Purpose:
- low-frequency internal configuration

Possible contents:
- source/tag dictionaries
- default time windows
- SSO metadata display
- internal help links

This page is low priority for v1.

## Data Model

### Existing system data to reuse

The internal backend should reuse these existing sources where possible:
- funnel events
- arena data
- runtime traces
- turn history
- release-relevant system metrics already derivable from app data

Do not duplicate these into new internal-only tables unless the read-model step requires materialization for performance.

### New editable data

Two internal business tables are enough for v1.

#### `internal_alpha_contacts`

Fields:
- `id`
- `display_name`
- `source`
- `owner_user_id`
- `status`
- `current_blocker`
- `next_follow_up_at`
- `last_activity_at`
- `notes`
- `tags`
- `created_at`
- `updated_at`

Purpose:
- operational roster and workflow state

#### `internal_release_gates`

Fields:
- `id`
- `gate_key`
- `status`
- `note`
- `evidence_url`
- `updated_by`
- `updated_at`

Purpose:
- explicit release gate state and evidence tracking

### Recommended status vocabulary

For alpha contacts:
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

Keep vocabulary fixed and explicit. Avoid freeform status strings.

## API Boundary

All internal backend routes live under `/internal/*`.

Recommended endpoints:

### Read endpoints

- `GET /internal/summary`
  - homepage rollup

- `GET /internal/funnel`
  - funnel counts, conversions, trends, breakdowns

- `GET /internal/alpha-contacts`
  - alpha roster table

- `GET /internal/alpha-contacts/:id`
  - detail drawer payload

- `GET /internal/arena-ops`
  - current arena operational view

- `GET /internal/runtime-health`
  - runtime red-zone summary

- `GET /internal/release-gates`
  - release gate list

### Write endpoints

- `PATCH /internal/alpha-contacts/:id`
  - update owner, status, blocker, follow-up time, notes, tags

- `PATCH /internal/release-gates/:id`
  - update gate status, note, evidence URL

No write endpoints for dangerous production operations in v1.

## Refresh Strategy

Approved model:
- summary and health near real-time
- roster and release-gate pages standard request/refresh

### Near real-time surfaces

- `Command Center`
- `Runtime Health`

These can poll on a short interval or use a lightweight streaming path later. Polling is acceptable for v1 if kept efficient.

### Standard refresh surfaces

- `Alpha Pipeline`
- `Release Gate`
- most of `Funnel`
- most of `Arena Ops`

Reason:
- editable tables benefit more from stable state than from twitchy real-time updates

## Error, Empty, and Partial States

Every page needs explicit states.

### Required error states

- SSO session invalid
- internal access denied
- summary source unavailable
- funnel source partially unavailable
- runtime health degraded
- alpha contact update failed
- release gate update failed

### Required empty states

- no alpha contacts yet
- no funnel data in selected range
- no current blockers
- no recent traces
- no unmet release gates

### Partial data rule

The UI should prefer partial rendering over all-or-nothing failure when possible.

Example:
- if funnel trend data fails but stage counts load, show the stage counts and mark trend as unavailable

## Component Boundaries

Recommended front-end decomposition:

1. route shells
   - page composition only

2. page-level data hooks/loaders
   - one per page domain

3. summary components
   - cards, small charts, badges, blockers

4. editable business components
   - alpha roster table
   - alpha detail drawer
   - release gate editor

5. health/diagnostic components
   - trace list
   - anomaly tables
   - latency widgets

Each component should have one clear purpose. Avoid a single 800-line “internal dashboard” page.

## URL and Navigation Rules

Recommended routes:
- `/internal`
- `/internal/alpha`
- `/internal/funnel`
- `/internal/arenas`
- `/internal/runtime`
- `/internal/release-gate`
- `/internal/settings`

Keep route names short and concrete.

## Operational Safety

Things the internal backend may do in v1:
- update alpha business workflow fields
- update release gate statuses and notes

Things it must not do in v1:
- restart services
- mutate live arena state
- replay queue events
- delete production data
- impersonate users

## Testing Strategy

### API

Add targeted tests for:
- internal auth guard behavior
- summary aggregation
- alpha roster reads/writes
- release gate reads/writes

### Web

Add targeted tests for:
- route gating
- summary rendering
- blocker queue rendering
- alpha edit form behavior
- release gate edit behavior
- partial-data behavior

### Manual

Manual verification checklist:
- SSO user can enter `/internal`
- unauthenticated user cannot
- homepage loads mixed summary correctly
- alpha updates persist and reflect immediately on refresh
- gate updates persist
- health view degrades gracefully when one upstream source fails

## Rollout Plan

### Phase 1

- route shell
- SSO guard
- Command Center
- Alpha Pipeline
- Release Gate

### Phase 2

- Funnel deep-dive
- Runtime Health
- Arena Ops

### Phase 3

- refinement
- saved filters
- better trend views
- optional external CRM sync hooks

## Open Decisions Already Resolved

- Internal only: yes
- Auth source: `sso.singularity-x.ai`
- Role split in v1: no
- Dangerous ops in v1: no
- Mount point: `/internal` inside existing `apps/web`
- Editable business data: yes
- Backing store for editable business data: Agon DB first
- Refresh model: mixed, near real-time for summary and health, standard refresh for workflow pages
- IA model: shared overview plus domain pages

## Recommendation

Start with:
1. internal auth shell
2. Command Center
3. Alpha Pipeline
4. Release Gate

That is the smallest slice that already feels like a real internal operating system.
