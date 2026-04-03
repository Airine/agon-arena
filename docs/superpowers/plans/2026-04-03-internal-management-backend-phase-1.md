# Internal Management Backend Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 1 MVP of the internal-only `/internal` console: internal auth shell, Command Center, Alpha Pipeline, Release Gate, and the first materialized funnel read path.

**Architecture:** Keep the system split into three clear surfaces. `apps/api` owns internal auth enforcement, internal data tables, funnel materialization, and `/internal/*` business APIs. `apps/web` owns the `/internal` route shell, page composition, and same-origin proxy endpoints for browser mutations. Phase 1 stops at operational truth plus lightweight business editing. No dangerous controls, no live Kafka reads on request paths, no role matrix.

**Tech Stack:** Next.js 15, React 19, Express, Drizzle ORM, PostgreSQL, KafkaJS, Vitest, existing Agon console shell components

---

## Scope Note

This plan intentionally covers only **Phase 1** from the approved spec:
- internal auth shell
- Command Center
- Alpha Pipeline
- Release Gate
- first funnel materialization path

Do **not** pull in Phase 2 pages (`Funnel` deep dive, `Runtime Health`, `Arena Ops`) into this implementation plan. Those get separate follow-on plans once Phase 1 is live and reviewed.

---

## File Structure

### API files

- Create: `apps/api/src/middleware/internal-auth.ts`
  - Trusted-header internal auth for `/internal/*`

- Create: `apps/api/src/routes/internal.ts`
  - Internal summary, alpha contacts, release gates

- Create: `apps/api/src/services/internal/funnel-materializer.ts`
  - Kafka consumer or scheduled materializer startup surface

- Create: `apps/api/src/services/internal/summary.ts`
  - Command Center aggregation

- Create: `apps/api/src/services/internal/alpha-contacts.ts`
  - Alpha roster CRUD helpers

- Create: `apps/api/src/services/internal/release-gates.ts`
  - Release gate CRUD helpers

- Modify: `apps/api/src/db/schema.ts`
  - Add `internal_alpha_contacts`
  - Add `internal_release_gates`
  - Add `internal_funnel_events`
  - Add `internal_funnel_stage_rollups`

- Modify: `apps/api/src/index.ts`
  - Mount internal routes
  - Start funnel materializer

- Create: `apps/api/src/routes/__tests__/internal.test.ts`
  - Internal route contract tests

- Create: `apps/api/src/services/__tests__/internal-funnel-materializer.test.ts`
  - Materializer and rollup tests

### Web files

- Create: `apps/web/src/middleware.ts`
  - Gate `/internal` using trusted internal headers

- Create: `apps/web/src/lib/internal-session.ts`
  - Shared helper to parse and validate internal SSO header contract

- Create: `apps/web/src/app/api/internal/summary/route.ts`
- Create: `apps/web/src/app/api/internal/alpha-contacts/route.ts`
- Create: `apps/web/src/app/api/internal/alpha-contacts/[id]/route.ts`
- Create: `apps/web/src/app/api/internal/release-gates/route.ts`
- Create: `apps/web/src/app/api/internal/release-gates/[id]/route.ts`
  - Same-origin proxy/BFF layer from web to API

- Create: `apps/web/src/app/(app)/internal/page.tsx`
  - Command Center page

- Create: `apps/web/src/app/(app)/internal/alpha/page.tsx`
  - Alpha Pipeline page

- Create: `apps/web/src/app/(app)/internal/release-gate/page.tsx`
  - Release Gate page

- Create: `apps/web/src/app/(app)/internal/_components/InternalNav.tsx`
  - Internal nav for Phase 1 pages

- Create: `apps/web/src/app/(app)/internal/_components/ActivationOverview.tsx`
- Create: `apps/web/src/app/(app)/internal/_components/FunnelSummary.tsx`
- Create: `apps/web/src/app/(app)/internal/_components/AlphaBlockerQueue.tsx`
- Create: `apps/web/src/app/(app)/internal/_components/ReleaseGateCard.tsx`
- Create: `apps/web/src/app/(app)/internal/_components/AlphaContactsTable.tsx`
- Create: `apps/web/src/app/(app)/internal/_components/AlphaContactDrawer.tsx`
- Create: `apps/web/src/app/(app)/internal/_components/ReleaseGateList.tsx`

- Create: `apps/web/src/app/(app)/internal/_lib/command-center-model.ts`
- Create: `apps/web/src/app/(app)/internal/_lib/alpha-contacts-model.ts`
- Create: `apps/web/src/app/(app)/internal/_lib/release-gates-model.ts`
  - Pure view-model helpers for testable rendering logic

- Create: `apps/web/src/app/(app)/internal/__tests__/command-center-model.test.ts`
- Create: `apps/web/src/app/(app)/internal/__tests__/alpha-contacts-model.test.ts`
- Create: `apps/web/src/app/(app)/internal/__tests__/release-gates-model.test.ts`

### Docs / artifacts

- Modify: `docs/superpowers/specs/2026-04-03-internal-management-backend-design.md`
  - Only if implementation uncovers a true spec contradiction

---

## Internal Auth Contract

Use a trusted header bridge from the upstream SSO layer.

Required request headers:

```text
x-internal-user-subject
x-internal-user-email
x-internal-user-name   (optional)
```

Create a shared contract on both web and API:

```ts
export interface InternalAuthContext {
  subject: string;
  email: string;
  displayName?: string;
}
```

Rules:
- This does **not** reuse product `req.user`
- Missing required headers on `/internal/*` = unauthorized
- Local development may use an explicit dev bypass env, but only for `/internal` work

Recommended dev envs:

```text
INTERNAL_AUTH_DEV_BYPASS=1
INTERNAL_DEV_SUBJECT=dev-internal-user
INTERNAL_DEV_EMAIL=dev@example.com
INTERNAL_DEV_NAME=Dev User
```

---

## Chunk 1: API Foundations

### Task 1: Add internal tables to Drizzle schema

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Generate: `apps/api/drizzle/0016_*.sql`
- Test: `apps/api/src/routes/__tests__/internal.test.ts`

- [ ] **Step 1: Add the four internal tables to schema**

Add these table definitions:
- `internal_alpha_contacts`
- `internal_release_gates`
- `internal_funnel_events`
- `internal_funnel_stage_rollups`

Use explicit columns from the spec. Keep owner/updater fields tied to SSO subject/email, not product `users.id`.

- [ ] **Step 2: Generate the migration**

Run:

```bash
pnpm --filter @agon/api db:generate
```

Expected:
- a new migration file appears in `apps/api/drizzle/`
- `apps/api/drizzle/meta/*` updates

- [ ] **Step 3: Add a schema smoke test**

In `apps/api/src/routes/__tests__/internal.test.ts`, add a basic import-level test that asserts the new schema exports exist:

```ts
it('exports internal tables', async () => {
  const mod = await import('../../db/schema.js');
  expect(mod.internalAlphaContacts).toBeDefined();
  expect(mod.internalReleaseGates).toBeDefined();
  expect(mod.internalFunnelEvents).toBeDefined();
  expect(mod.internalFunnelStageRollups).toBeDefined();
});
```

- [ ] **Step 4: Run the test**

Run:

```bash
pnpm --filter @agon/api exec vitest run src/routes/__tests__/internal.test.ts
```

Expected:
- fail first if exports or paths are wrong
- pass after the schema is wired correctly

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/src/routes/__tests__/internal.test.ts
git commit -m "feat: add internal management schema tables"
```

### Task 2: Add internal auth middleware

**Files:**
- Create: `apps/api/src/middleware/internal-auth.ts`
- Modify: `apps/api/src/routes/__tests__/internal.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write the failing auth guard tests**

Add route-level tests for:
- missing internal headers → `401`
- present headers → handler sees parsed `InternalAuthContext`
- dev bypass env path works only when explicitly enabled

Example:

```ts
it('rejects internal routes without trusted headers', async () => {
  const res = await request(app).get('/internal/summary');
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Implement `internal-auth.ts`**

Export:
- `InternalAuthContext`
- `requireInternalAuth`

Behavior:
- parse `x-internal-user-subject`
- parse `x-internal-user-email`
- parse optional `x-internal-user-name`
- attach parsed object to request context
- reject missing required fields
- honor the explicit dev bypass env only when enabled

- [ ] **Step 3: Mount a temporary protected probe route**

In the internal route test app, add a tiny protected endpoint using `requireInternalAuth` before the real route handler exists. This proves middleware behavior in isolation.

- [ ] **Step 4: Run the tests**

Run:

```bash
pnpm --filter @agon/api exec vitest run src/routes/__tests__/internal.test.ts
```

Expected:
- tests fail before middleware exists
- tests pass after middleware is implemented

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/internal-auth.ts apps/api/src/routes/__tests__/internal.test.ts apps/api/src/index.ts
git commit -m "feat: add internal auth middleware"
```

### Task 3: Scaffold internal route module and mount it

**Files:**
- Create: `apps/api/src/routes/internal.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/routes/__tests__/internal.test.ts`

- [ ] **Step 1: Write failing route tests for the three MVP resources**

Add failing tests for:
- `GET /internal/summary`
- `GET /internal/alpha-contacts`
- `GET /internal/release-gates`

Use simple mocked service responses at first.

- [ ] **Step 2: Implement `internal.ts` skeleton**

Create the router and mount:
- `GET /summary`
- `GET /alpha-contacts`
- `PATCH /alpha-contacts/:id`
- `GET /release-gates`
- `PATCH /release-gates/:id`

All routes must use `requireInternalAuth`.

- [ ] **Step 3: Mount router in `index.ts`**

Add:

```ts
app.use('/internal', internalRouter);
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @agon/api exec vitest run src/routes/__tests__/internal.test.ts
pnpm --filter @agon/api typecheck
```

Expected:
- route tests pass
- no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/internal.ts apps/api/src/index.ts apps/api/src/routes/__tests__/internal.test.ts
git commit -m "feat: mount internal api routes"
```

## Chunk 2: Materialized Funnel and MVP API Logic

### Task 4: Implement alpha contacts service and endpoints

**Files:**
- Create: `apps/api/src/services/internal/alpha-contacts.ts`
- Modify: `apps/api/src/routes/internal.ts`
- Modify: `apps/api/src/routes/__tests__/internal.test.ts`

- [ ] **Step 1: Write failing tests for alpha contact reads/writes**

Cover:
- list contacts
- fetch one contact detail payload
- patch allowed fields
- reject patch attempts for unsupported fields

- [ ] **Step 2: Implement the service**

Create explicit functions:
- `listAlphaContacts`
- `getAlphaContact`
- `updateAlphaContact`

Keep patchable fields narrow:
- `ownerSubject`
- `ownerEmail`
- `status`
- `currentBlocker`
- `nextFollowUpAt`
- `notes`
- `tags`

- [ ] **Step 3: Wire route handlers**

Keep the route layer thin:
- validate payload with Zod
- call service
- return normalized JSON

- [ ] **Step 4: Run the tests**

Run:

```bash
pnpm --filter @agon/api exec vitest run src/routes/__tests__/internal.test.ts
```

Expected:
- the alpha-contact test block passes

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/internal/alpha-contacts.ts apps/api/src/routes/internal.ts apps/api/src/routes/__tests__/internal.test.ts
git commit -m "feat: add internal alpha contact apis"
```

### Task 5: Implement release gate service and endpoints

**Files:**
- Create: `apps/api/src/services/internal/release-gates.ts`
- Modify: `apps/api/src/routes/internal.ts`
- Modify: `apps/api/src/routes/__tests__/internal.test.ts`

- [ ] **Step 1: Write failing tests for release gate reads/writes**

Cover:
- list gates
- patch status
- patch note
- patch evidence URL
- capture updater subject/email from internal auth context

- [ ] **Step 2: Implement the service**

Create:
- `listReleaseGates`
- `updateReleaseGate`

`updateReleaseGate` must persist:
- `updatedBySubject`
- `updatedByEmail`
- `updatedAt`

- [ ] **Step 3: Wire route handlers**

Add route logic in `internal.ts`.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @agon/api exec vitest run src/routes/__tests__/internal.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/internal/release-gates.ts apps/api/src/routes/internal.ts apps/api/src/routes/__tests__/internal.test.ts
git commit -m "feat: add internal release gate apis"
```

### Task 6: Add the first funnel materialization path

**Files:**
- Create: `apps/api/src/services/internal/funnel-materializer.ts`
- Create: `apps/api/src/services/__tests__/internal-funnel-materializer.test.ts`
- Modify: `apps/api/src/services/kafka.ts` only if needed for shared types/helpers
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write failing materializer tests**

Cover:
- ingest one funnel event into `internal_funnel_events`
- update the correct rollup bucket in `internal_funnel_stage_rollups`
- handle duplicate events safely if the same message is seen twice

Minimal test shape:

```ts
it('materializes first_action_submitted into the rollup bucket', async () => {
  const event = {
    eventType: 'agent_funnel',
    stage: 'first_action_submitted',
    agentId: 'agent-1',
    userId: 'user-1',
    arenaId: 'arena-1',
    ts: '2026-04-03T00:00:00.000Z',
  };
  // assert raw event write + rollup increment
});
```

- [ ] **Step 2: Implement the materializer**

Start with one clear service:
- subscribe to `agon.agent.funnel`
- normalize event
- write raw event row
- update bucketed rollup row

Keep the materializer surface isolated. No page code should know Kafka exists.

- [ ] **Step 3: Start it from `index.ts`**

Add startup only when the required Kafka env exists. Keep no-op behavior in environments without Kafka.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @agon/api exec vitest run src/services/__tests__/internal-funnel-materializer.test.ts
pnpm --filter @agon/api typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/internal/funnel-materializer.ts apps/api/src/services/__tests__/internal-funnel-materializer.test.ts apps/api/src/index.ts
git commit -m "feat: materialize internal funnel rollups"
```

### Task 7: Implement Command Center summary API

**Files:**
- Create: `apps/api/src/services/internal/summary.ts`
- Modify: `apps/api/src/routes/internal.ts`
- Modify: `apps/api/src/routes/__tests__/internal.test.ts`

- [ ] **Step 1: Write failing tests for `GET /internal/summary`**

Cover the five Phase 1 cards:
- activation overview
- funnel summary
- alpha blocker queue
- runtime red zone
- release gate summary

- [ ] **Step 2: Implement `summary.ts`**

Export a single aggregator:

```ts
export async function getInternalSummary(now = new Date()): Promise<InternalSummaryResponse>
```

The response should be page-ready. Do not make the web app assemble five unrelated payloads.

- [ ] **Step 3: Wire route handler**

Add `GET /internal/summary` in `internal.ts`.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @agon/api exec vitest run src/routes/__tests__/internal.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/internal/summary.ts apps/api/src/routes/internal.ts apps/api/src/routes/__tests__/internal.test.ts
git commit -m "feat: add internal command center summary api"
```

## Chunk 3: Web Shell and Pages

### Task 8: Add web internal-session helper and `/internal` gate

**Files:**
- Create: `apps/web/src/lib/internal-session.ts`
- Create: `apps/web/src/middleware.ts`
- Create: `apps/web/src/app/(app)/internal/_components/InternalNav.tsx`
- Create: `apps/web/src/app/(app)/internal/page.tsx`
- Test: `apps/web/src/app/(app)/internal/__tests__/command-center-model.test.ts`

- [ ] **Step 1: Write the failing helper test**

Test the pure parser:

```ts
it('extracts internal user context from trusted headers', () => {
  const result = parseInternalSessionHeaders(
    new Headers({
      'x-internal-user-subject': 'staff-1',
      'x-internal-user-email': 'staff@example.com',
    }),
  );
  expect(result.subject).toBe('staff-1');
});
```

- [ ] **Step 2: Implement `internal-session.ts`**

Create:
- `parseInternalSessionHeaders`
- `hasInternalSession`

This should be pure and easily testable.

- [ ] **Step 3: Implement Next middleware**

Gate `/internal/:path*`.

Behavior:
- if trusted headers absent and no dev bypass, redirect to `INTERNAL_SSO_LOGIN_URL`
- if present, allow through

- [ ] **Step 4: Add `InternalNav`**

Phase 1 links only:
- Command Center
- Alpha Pipeline
- Release Gate

Do not build placeholder links for Phase 2 pages yet.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
pnpm --filter @agon/web test -- 'src/app/(app)/internal/__tests__/command-center-model.test.ts'
pnpm --filter @agon/web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/internal-session.ts apps/web/src/middleware.ts apps/web/src/app/'(app)'/internal
git commit -m "feat: add internal web shell and auth gate"
```

### Task 9: Add Next route-handler proxies for internal APIs

**Files:**
- Create: `apps/web/src/app/api/internal/summary/route.ts`
- Create: `apps/web/src/app/api/internal/alpha-contacts/route.ts`
- Create: `apps/web/src/app/api/internal/alpha-contacts/[id]/route.ts`
- Create: `apps/web/src/app/api/internal/release-gates/route.ts`
- Create: `apps/web/src/app/api/internal/release-gates/[id]/route.ts`

- [ ] **Step 1: Write a failing proxy helper test**

Create or extend a pure helper around forwarding rules:
- preserves trusted internal headers
- forwards method/body for PATCH
- returns upstream error payloads unchanged where safe

- [ ] **Step 2: Implement the route handlers**

Each route handler should:
- read trusted internal headers from the incoming request
- call the Express internal API using `buildApiUrl`
- forward JSON back to the browser

Do not let client components call the Express API directly in v1.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @agon/web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/internal
git commit -m "feat: add internal web api proxies"
```

### Task 10: Build Command Center page

**Files:**
- Create: `apps/web/src/app/(app)/internal/_lib/command-center-model.ts`
- Create: `apps/web/src/app/(app)/internal/_components/ActivationOverview.tsx`
- Create: `apps/web/src/app/(app)/internal/_components/FunnelSummary.tsx`
- Create: `apps/web/src/app/(app)/internal/_components/AlphaBlockerQueue.tsx`
- Create: `apps/web/src/app/(app)/internal/_components/ReleaseGateCard.tsx`
- Modify: `apps/web/src/app/(app)/internal/page.tsx`
- Test: `apps/web/src/app/(app)/internal/__tests__/command-center-model.test.ts`

- [ ] **Step 1: Write failing model tests**

Cover:
- card ordering
- empty-state fallback values
- partial-data degradation

- [ ] **Step 2: Implement `command-center-model.ts`**

Create one function that maps `GET /api/internal/summary` into UI-ready sections.

- [ ] **Step 3: Build the page and components**

Layout order must match the spec:
1. Activation Overview
2. Funnel Summary
3. Alpha Blocker Queue
4. Runtime Red Zone
5. Release Gate

Use the existing console primitives in `apps/web/src/components/chrome.tsx`.

- [ ] **Step 4: Add mixed refresh behavior**

Use polling on the page:
- 15-30s refresh interval
- show stale/refresh state clearly
- preserve partial rendering if one section fails

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
pnpm --filter @agon/web test -- 'src/app/(app)/internal/__tests__/command-center-model.test.ts'
pnpm --filter @agon/web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/'(app)'/internal
git commit -m "feat: add internal command center"
```

### Task 11: Build Alpha Pipeline page

**Files:**
- Create: `apps/web/src/app/(app)/internal/_lib/alpha-contacts-model.ts`
- Create: `apps/web/src/app/(app)/internal/_components/AlphaContactsTable.tsx`
- Create: `apps/web/src/app/(app)/internal/_components/AlphaContactDrawer.tsx`
- Create: `apps/web/src/app/(app)/internal/alpha/page.tsx`
- Test: `apps/web/src/app/(app)/internal/__tests__/alpha-contacts-model.test.ts`

- [ ] **Step 1: Write failing model tests**

Cover:
- column rendering
- filter behavior
- status badge mapping
- patch payload generation

- [ ] **Step 2: Implement model helpers**

Keep all formatting and option mapping out of the page component.

- [ ] **Step 3: Build table + drawer**

Required editable fields:
- owner
- status
- blocker
- next follow-up
- notes
- tags

Required read fields:
- latest funnel stage
- latest arena activity
- latest runtime issues if any

- [ ] **Step 4: Wire PATCH workflow**

Use the Next same-origin proxy routes for mutation.
Show optimistic/pending state, but fall back cleanly if save fails.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
pnpm --filter @agon/web test -- 'src/app/(app)/internal/__tests__/alpha-contacts-model.test.ts'
pnpm --filter @agon/web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/'(app)'/internal
git commit -m "feat: add internal alpha pipeline"
```

### Task 12: Build Release Gate page

**Files:**
- Create: `apps/web/src/app/(app)/internal/_lib/release-gates-model.ts`
- Create: `apps/web/src/app/(app)/internal/_components/ReleaseGateList.tsx`
- Create: `apps/web/src/app/(app)/internal/release-gate/page.tsx`
- Test: `apps/web/src/app/(app)/internal/__tests__/release-gates-model.test.ts`

- [ ] **Step 1: Write failing model tests**

Cover:
- gate status mapping
- unmet vs met grouping
- patch payload generation

- [ ] **Step 2: Implement model helpers**

Map API data into:
- gate checklist rows
- evidence links
- note summaries

- [ ] **Step 3: Build the page**

Required capabilities:
- list gates
- inline or drawer editing for status/note/evidence URL
- show last updated by / at

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @agon/web test -- 'src/app/(app)/internal/__tests__/release-gates-model.test.ts'
pnpm --filter @agon/web typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/'(app)'/internal
git commit -m "feat: add internal release gate page"
```

## Chunk 4: Verification and Handoff

### Task 13: Run the full Phase 1 verification bundle

**Files:**
- Verify all changed files from prior tasks

- [ ] **Step 1: Run API tests**

```bash
pnpm --filter @agon/api exec vitest run src/routes/__tests__/internal.test.ts
pnpm --filter @agon/api exec vitest run src/services/__tests__/internal-funnel-materializer.test.ts
```

- [ ] **Step 2: Run API typecheck**

```bash
pnpm --filter @agon/api typecheck
```

- [ ] **Step 3: Run web tests**

```bash
pnpm --filter @agon/web test -- 'src/app/(app)/internal/__tests__/command-center-model.test.ts'
pnpm --filter @agon/web test -- 'src/app/(app)/internal/__tests__/alpha-contacts-model.test.ts'
pnpm --filter @agon/web test -- 'src/app/(app)/internal/__tests__/release-gates-model.test.ts'
```

- [ ] **Step 4: Run web typecheck**

```bash
pnpm --filter @agon/web typecheck
```

- [ ] **Step 5: Manual verification**

Check:
- `/internal` redirects when no internal session
- `/internal` loads with internal dev bypass or real internal session
- Command Center polling works
- alpha edits persist
- release gate edits persist
- partial failure still renders the rest of the page

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: ship internal management backend phase 1"
```

---

## Notes For The Implementer

1. Keep Phase 1 narrow. Do not pull in Funnel deep-dive, Runtime Health page, or Arena Ops page beyond what the homepage summary needs.
2. Keep internal staff identity separate from product-user identity everywhere.
3. Do not query Kafka on request paths.
4. Do not let any internal route piggyback on product auth assumptions.
5. Prefer boring UI. This is an operations tool.

---

## Future Plans, Not This One

These need separate plans after Phase 1 ships:
- full Funnel page
- Runtime Health page
- Arena Ops page
- saved filters
- richer trend analysis
- external CRM sync
