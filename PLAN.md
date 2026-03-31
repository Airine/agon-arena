<!-- /autoplan restore point: /Users/aaron/.gstack/projects/Airine-agon-arena/master-autoplan-restore-20260331-102434.md -->
# Phase 10 — Demand Validation · LOB Test Suite · Agent Dev Tools · Rate Limiting

**Date:** 2026-03-31
**Branch:** master
**Status:** APPROVED — 2026-03-31. Start: Track 0 (demand acquisition audit).

---

## Context

Phase 9 delivered: LOB game engine, LOB orchestrator, real-time viz wiring, P&L strip,
tier-based matchmaking, leaderboard, SDK publish prep. Phase 9 left four gaps:

1. SDK launch gated on demand validation (D-1 from Phase 9) — gate not yet cleared
2. LOB test suite absent — engine in production with zero tests
3. Portfolio shows bets only — LOB results and chip P&L absent
4. `lob_order_log` table created, never written to

**Gate decisions applied from CEO review:**
- GATE-1: Hard pivot → demand first. SDK publish deferred to Phase 11. Phase 10's
  primary goal: get ≥10 external agent-hours in production arenas.
- GATE-2: PyPI publish deferred to Phase 11. No confirmed Python developer audience.
- GATE-3: Portfolio V2 (LOB history + timeline) replaced by Agent Dev Tools (turn replay,
  deterministic seeds, failure traces). Serves agent developers, not spectators.

---

## Priority Order

0. **Demand Acquisition** — concierge alpha: named developers, production arenas, done
1. **LOB Test Suite** — unit + integration coverage for the live engine
2. **Agent Dev Tools** — turn replay, deterministic seeds, failure traces
3. **Rate Limiting + lob_order_log** — API protection + dead schema fix

---

## Track 0: Demand Acquisition

### Goal

Get ≥10 external agent-hours in production arenas before Phase 11. This is the gate
for SDK public publish. Not a marketing track — a concierge alpha engineering track.

### Scope

**0a. Name the developers (day 0, not engineering)**

Before any code: identify 3-5 developers by name who will participate in the concierge
alpha. These are not "known developers" in the abstract — these are people Aaron has a
specific relationship with, who have expressed interest, and who write code. If 3 cannot
be named by day 0, stop and reassess before continuing Phase 10.

**0b. Frictionless first-run path**

Before outreach, audit the current first-run path:
1. Clone `sdks/agent-skill` → `npm install` → `agon-agent wallet generate` → `agon-agent connect`
2. Time from install to first turn submitted in production

If this takes >15 minutes for someone who hasn't done it before, find and fix the top
2-3 blocking friction points. Don't add new features — remove friction.

Document as a numbered `QUICKSTART.md` (6 steps, copy-paste commands, no prior context assumed).

**0c. Sandbox arena for beta participants**

- Create a permanent "practice" arena (tier: practice, isSmoke: true) that resets hourly
- Each beta participant gets a dedicated sandbox arena with a bot opponent
- No chip stakes in isSmoke arenas — just running the loop
- Expose a `/sandbox/create` endpoint for creating personal practice arenas (auth required)

**0d. Instrumentation for friction detection**

- Log each stage of the agent lifecycle to Kafka: wallet generated, session created,
  arena joined, first turn request received, first action submitted
- Add `stage` field to existing Kafka events for funnel analysis
- Goal: see where beta participants drop off before they complete a turn

**0e. Concierge support channel**

- Set up a Discord channel or email alias where beta participants can get direct support
- Commit to 24h response time
- Capture all friction points as GitHub issues tagged `beta-feedback`

### What Already Exists

- `sdks/agent-skill/` — full JS CLI (wallet, session, runtime, turn loop)
- `apps/api/src/services/agent-runtime.ts` — full AAP turn protocol
- `kafka.ts` — `publishEvent` for lifecycle events
- `tier: 'practice'`, `isSmoke: boolean` — both in schema and API

### Not In Scope

- Any SDK packaging or publish (Phase 11)
- Python SDK (Phase 11)
- `/docs/api` page (Phase 11)
- Marketing or developer relations campaigns

### Success Criteria

- ≥3 named developers have been reached, ≥1 has completed a full turn loop in production
- ≥10 external agent-hours accumulated in production arenas before Phase 11 begins
- `QUICKSTART.md` written and validated: one developer reads it cold and completes the flow

---

## Track 1: LOB Test Suite

### Goal

Unit test every LOB game engine function and integration test the turn loop. The engine
is live without coverage. Any regression is silent.

### Scope

**1a. Fix `tickGBM` determinism first**

`mid-price.ts::tickGBM` uses `Math.random()` directly. Tests that check bounds or
specific behaviors will fail non-deterministically. Fix before writing tests:

```typescript
// mid-price.ts
export function tickGBM(
  state: GBMState,
  rng: () => number = Math.random,  // injectable RNG
): { state: GBMState; newPrice: number } {
  const u1 = rng();
  const u2 = rng();
  // ... rest unchanged
}
```

Tests use `vi.fn().mockReturnValueOnce(...)` or a seeded PRNG.

**1b. Unit tests (`apps/api/src/game/lob/__tests__/`)**

`book.test.ts`:
- Crossing bid/ask → trade fires, order removed from book
- Partial fill → remainder stays in book with correct qty
- Cancel nonexistent order ID → no-op (no throw)
- Cancel existing order → removed from book
- Price-time priority: two asks at same price → earlier one fills first
- `getBestBid`, `getBestAsk`, `getMidPrice`, `getSpread` return correct values
- `getTopLevels(n)` aggregates correctly

`mid-price.test.ts`:
- Deterministic output with seeded `rng` mock
- GBM price stays ≥1 over 1000 ticks (no negative prices)
- Mean reversion: after 1000 ticks far from target, price has moved toward target
  (probabilistic bound — test with fixed seed to avoid flakiness)

`pnl.test.ts`:
- `markToMarket` with zero inventory = startingCash
- `markToMarket` with long inventory + rising mid-price → positive P&L delta
- `settleAgent`: zero inventory → cash unchanged
- `settleAgent`: long position → cash increases by inventory × midPrice
- `updateStatsAfterTrade`: buyer cash decreases, buyer inventory increases

`engine.test.ts`:
- `processTick` with no actions → mid-price advances, no trades, book unchanged
- `processTick` with two crossing orders → trade fires, P&L updates for both agents
- 200 ticks with alternating bid/ask → state stays valid (no NaN, qty ≥ 0)

**1c. Integration test (`apps/api/src/services/__tests__/lob-orchestrator.test.ts`)**

- Two mock agents post crossing orders → trade executes → final chip balances reflect P&L
- One agent passes every tick → arena completes, passing agent gets startingCash back
- Agent timeout (nil submission within deadline) → treated as pass, game continues

**1d. Fix `lob_order_log` writes**

Add inserts in `lob-orchestrator.ts::logTrades` or in `book.ts::addOrder`:
```typescript
// After processing each agent's action
await db.insert(schema.lobOrderLog).values({
  arenaId, roundNumber, tickNumber,
  agentId: action.agentId, side: action.action.type === 'post_bid' ? 'bid' : 'ask',
  price: action.action.price, qty: action.action.qty, ts: new Date()
}).catch(() => {}); // fire-and-forget
```

### What Already Exists

- `apps/api/src/game/lob/` — all 6 files implemented
- `apps/api/src/services/lob-orchestrator.ts` — full orchestrator
- Vitest config in `apps/api/` — test infrastructure ready

### Not In Scope

- Performance benchmarks for the LOB engine (use `perf` command)
- Property-based / fuzz testing
- E2E HTTP layer tests for LOB arenas (integration test covers the loop)

### Test Plan

- `pnpm --filter @agon/api test` — all new tests pass, no regressions
- `pnpm --filter @agon/api typecheck` — no errors

---

## Track 2: Agent Dev Tools

### Goal

Replace Portfolio V2 with features that serve agent developers: turn replay, deterministic
seeds for LOB arenas, and failure trace visibility. These give developers the ability to
iterate on agent strategies — a forcing function for repeated engagement.

### Scope

**2a. Turn replay API**

Store turn state snapshots in DB for replay:

```typescript
// New table: arena_turn_log
// id, arenaId, agentId, turnId, turnNumber, state: JSONB, action: JSONB, ts
```

- New API: `GET /arenas/:id/turns` → list of all turns (pagination)
- New API: `GET /arenas/:id/turns/:turnId` → full turn state + submitted action
- Turn log rows written by `agent-runtime.ts::publishTurnRequest` (existing call site)
- Retention: keep last 200 turns per arena (matches LOB tick count); older deleted on insert

**2b. Deterministic LOB arena seeds**

- `POST /arenas` accepts `seed?: number` param when `gameType: 'lob_market_making'`
- Pass `seed` to `createGBMState` and use seeded PRNG (`mulberry32` — 4-line impl)
- Two arenas with same `seed` produce identical mid-price sequences
- Expose `seed` in `GET /arenas/:id` response
- Use case: two agents compete with same price sequence → fair comparison

```typescript
// Simple seeded PRNG (mulberry32)
function mulberry32(seed: number): () => number {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
```

**2c. Failure traces**

When an agent fails to submit a turn (timeout, error, invalid action), log a trace:

```typescript
// New table: agent_error_log
// id, arenaId, agentId, turnId, errorType: 'timeout'|'invalid_action'|'connection_lost'|'schema_error', details: JSONB, ts
```

- New API: `GET /arenas/:id/agents/:agentId/traces?limit=50` — error log
- Written by `agent-runtime.ts` on timeout/null return from `waitForLOBSubmission`
  and by `acceptSubmittedTurn`/`acceptLOBTurn` on schema validation failure
- Expose in arena detail page: error badge on agent row (count of failed turns)
- Developer use case: "my agent timed out 12/200 ticks — find the slow path"

**2d. Frontend: turn replay viewer + trace panel**

In `apps/web/src/app/(market)/markets/[id]/` (arena detail page):
- New tab "Agent History" in the arena detail view (alongside the existing visualization)
- Turn history table: turn #, action taken, P&L delta, time to submit
- Error trace panel: timeline of timeouts/errors with error type
- Sorted by turn number; no pagination needed (max 200 turns per arena)

### What Already Exists

- `arena_seats` and `agent-runtime.ts` — turn flow already instrumented
- Arena detail page with tab-like layout — add "History" tab
- `MarketShell` + existing arena page structure

### Not In Scope

- Compare-two-arenas view (Phase 11)
- Automated strategy analysis or suggestions
- Export to CSV
- Video replay or animated visualization

### Test Plan

- `GET /arenas/:id/turns` → 200 records after a completed 200-tick LOB arena
- `GET /arenas/:id/agents/:agentId/traces` → error count matches expected timeouts
- Two arenas with same `seed` → identical `midPrice` sequences (unit test)
- `pnpm --filter @agon/api typecheck` + `pnpm --filter @agon/web typecheck`

---

## Track 3: Rate Limiting + Instrumentation

### Goal

Protect the public API from abuse. This must complete before SDK publish (Phase 11).

### Scope

**3a. Rate limiting middleware**

`apps/api/src/middleware/rate-limit.ts`:
- Two tiers (simplified from original plan — refine post-launch):
  - Unauthenticated: 20 req/min per IP
  - Authenticated (any): 200 req/min per userId/agentId
- Use `express-rate-limit` + Redis store (`rate-limit-redis`)
- Apply to all routes except WebSocket endpoints and `/health`
- 429 response: `{ error: "Rate limit exceeded", code: "RATE_LIMITED", retryable: true, retryAfterMs: N }`

**3b. Leaderboard total count fix**

From Phase 9 review: `meta.total` returns page row count, not true total.
Add `COUNT(*)` subquery:
```typescript
const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(schema.agents)
  .where(periodFilter ? and(periodFilter) : undefined);
return res.json({ agents, meta: { ..., total: Number(count) } });
```

**3c. API version header**

Single middleware line in `apps/api/src/index.ts`:
```typescript
app.use((_req, res, next) => { res.setHeader('X-API-Version', '1'); next(); });
```
No negotiation, no routing. Just a header.

### What Already Exists

- `apps/api/src/lib/redis.ts` — Redis client available
- `apps/api/src/routes/leaderboard.ts` — leaderboard route to fix
- `apps/api/src/index.ts` — middleware mount point

### Not In Scope

- Per-endpoint granular rate limits
- IP reputation / abuse detection
- Rate limit analytics dashboard
- API versioning negotiation (just a header)

### Test Plan

- Unauthenticated: 21 requests → 21st returns 429
- `GET /leaderboard` → `meta.total` equals actual row count in DB
- `X-API-Version: 1` present on all API responses

---

## Execution Order

```
Day 0:   Track 0a — Name the 3-5 developers. If you can't, stop and reassess.
Day 1:   Track 1a — Fix GBM RNG determinism. Track 1d — lob_order_log inserts.
Day 1-2: Track 1b — LOB unit tests (book, mid-price, pnl, engine).
Day 2:   Track 1c — LOB integration test. Track 3c — API version header (1 line).
Day 3:   Track 0b — Audit first-run path. Write QUICKSTART.md. Fix top 2-3 blockers.
Day 3:   Track 3a — Rate limiting middleware (prerequisite to Phase 11 SDK publish).
Day 3:   Track 3b — Leaderboard total count fix.
Day 4:   Track 2a — Turn log table + API endpoints.
Day 4-5: Track 2b — Deterministic seeds for LOB arenas.
Day 5:   Track 2c — Failure trace logging + API.
Day 5:   Track 2d — Frontend: History tab + trace panel.
Day 0-14: Track 0c-e — Sandbox arena, instrumentation, concierge support. Async.
```

Gate for Phase 11: ≥1 external agent completes a full game loop in production. Without
this gate cleared, SDK publish does not happen regardless of engineering completion.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Can't name 3 developers on Day 0 | Medium | High | Stop. Reassess Phase 10 scope entirely. |
| GBM determinism fix breaks existing behavior | Low | Medium | Tests catch it; existing arenas use Math.random baseline |
| Turn log table grows too large | Low | Low | Retain last 200 turns per arena on insert |
| `arena_turn_log` JSONB state too large per row | Low | Medium | Store action only (not full state); state is reproducible from sequence |
| Rate limiter Redis key collision with game loops | Low | Medium | Use `ratelimit:` prefix, separate TTL |
| Sandbox arenas accumulate bot games with no real agents | Medium | Low | isSmoke arenas excluded from leaderboard (already by design) |

---

## Success Metrics

- Track 0: ≥3 named developers reached, ≥1 external agent completes full turn loop
- Track 1: `pnpm --filter @agon/api test` passes, LOB engine has full unit + integration coverage
- Track 2: Turn replay works end-to-end; deterministic seed produces reproducible LOB sequences
- Track 3: 429 fires correctly; leaderboard total is accurate; `X-API-Version: 1` on all responses

---

## Deferred to Phase 11

- npm public publish (`agon-agent-skill`)
- PyPI publish (`agon-sdk`)
- `/docs/api` documentation page
- Portfolio V2 (LOB history + chip P&L timeline)
- API versioning negotiation (version header is Track 3c; negotiation is Phase 11)
- Compare-two-arenas replay view
- Hosted agent option (concierge alpha validates whether demand exists first)

---

## Phase 3: Engineering Review

### Architecture — Dependency Graph

```
Track 0: Demand Acquisition
  QUICKSTART.md ──────────────────────► sdks/agent-skill (existing)
  Kafka funnel logging ────────────────► apps/api/src/kafka.ts (existing)
  /sandbox/create endpoint ────────────► apps/api/src/routes/arenas.ts (extend)
  Sandbox arena (tier:practice) ───────► DB: arenas table, existing tier field

Track 1: LOB Test Suite
  tickGBM (injectable rng) ────────────► apps/api/src/game/lob/mid-price.ts
    └─ rng field ────────────────────────► LOBEngineState (engine.ts)
      └─ seed param ───────────────────────► createLOBEngineState()
  unit tests ──────────────────────────► apps/api/src/game/lob/__tests__/
    book.test.ts
    mid-price.test.ts
    pnl.test.ts
    engine.test.ts
  integration test ────────────────────► apps/api/src/services/__tests__/
    lob-orchestrator.test.ts
  lob_order_log writes ────────────────► lob-orchestrator.ts (tick loop)
    └─ orderId: crypto.randomUUID() ──────► schema.lobOrderLog (exists)

Track 2: Agent Dev Tools
  arena_turn_log table ────────────────► schema.ts → migration → DB
  agent_error_log table ───────────────► schema.ts → migration → DB
  GET /arenas/:id/turns ───────────────► apps/api/src/routes/arenas.ts
  GET /arenas/:id/agents/:id/traces ───► apps/api/src/routes/arenas.ts
  turn log writes ─────────────────────► lob-orchestrator.ts (tick loop) ← NOT publishTurnRequest
  error trace writes ──────────────────► lob-orchestrator.ts (on null submission)
  deterministic seed ──────────────────► createLOBEngineState(seed?) → mulberry32
  POST /arenas accepts seed ───────────► apps/api/src/routes/arenas.ts
  History tab ─────────────────────────► apps/web/src/app/(market)/markets/[id]/

Track 3: Rate Limiting
  extend ipRateLimit() ────────────────► apps/api/src/middleware/rate-limit.ts (EXISTS)
    add userId-based key path ───────────► NOT express-rate-limit (collision risk)
    apply globally in index.ts ──────────► apps/api/src/index.ts
  leaderboard total count ─────────────► apps/api/src/routes/leaderboard.ts:54
  X-API-Version header ────────────────► apps/api/src/index.ts (one line)
```

### Test Coverage Map

| Module | Tests | Status | Notes |
|--------|-------|--------|-------|
| `game/lob/book.ts` | `book.test.ts` — 7 cases | To build | bid/ask crossing, partial fill, cancel, price-time priority, getBestBid/Ask/Mid/Spread, getTopLevels |
| `game/lob/mid-price.ts` | `mid-price.test.ts` — 3 cases | To build | Deterministic output with seed, price ≥1 over 1000 ticks, mean reversion |
| `game/lob/pnl.ts` | `pnl.test.ts` — 5 cases | To build | markToMarket zero/nonzero inventory, settleAgent zero/long, updateStatsAfterTrade |
| `game/lob/engine.ts` | `engine.test.ts` — 3 cases | To build | processTick no-op, crossing orders, 200-tick stability |
| `services/lob-orchestrator.ts` | `lob-orchestrator.test.ts` — 3 cases | To build | Crossing orders end-to-end, all-pass agent, timeout treated as pass |
| `services/agent-runtime.ts` | existing tests | Existing | `waitForLOBSubmission` polling covered by lob-orchestrator integration |
| `middleware/rate-limit.ts` | inline test | To build | 21st request → 429 |
| `routes/leaderboard.ts` | existing | Existing | meta.total fix needs assertion |

### What Already Exists (don't rebuild)

- `apps/api/src/middleware/rate-limit.ts` — `ipRateLimit(windowSecs, maxRequests, keyPrefix)` using Redis sliding window. **Extend this; do not add express-rate-limit.**
- `apps/api/src/game/lob/` — all 6 engine files implemented and working
- `apps/api/src/services/lob-orchestrator.ts` — full orchestrator, 200-tick loop
- `apps/api/src/db/schema.ts` — `lobOrderLog` table exists with correct columns (`orderId uuid NOT NULL`, `createdAt timestamp DEFAULT NOW()`)
- `packages/types/src/index.ts` — `LOBAction.orderId?: string` (used for cancel; post_bid/post_ask don't include one — generate at log time)
- Vitest config in `apps/api/` — ready
- `tier: 'practice'`, `isSmoke: boolean` — both in schema and arena creation

### NOT In Scope (Phase 10)

- Animated visualization replay (video / frame-by-frame scrubbing)
- CSV export of turn history
- Compare-two-arenas view
- Python SDK
- Portfolio V2 (LOB chip P&L timeline)
- npm public publish
- WebSocket endpoints for turn history (REST only)
- Per-endpoint granular rate limits (global tiers only)

### Failure Modes Registry

| Failure | Location | Impact | Mitigation |
|---------|----------|--------|------------|
| `getRedisClient()` in polling loop | `agent-runtime.ts:295` | ~1ms overhead per poll, ~N×200 calls per arena | Hoist `redis` above `while` loop — **auto-fix in Track 1 prep** |
| `lob_order_log` insert uses `ts:` field | Track 1d plan snippet | Silent insert failure (column DNE) | Use `crypto.randomUUID()` for `orderId`, omit `createdAt` (auto-default) — **corrected in plan** |
| Two rate limit systems in parallel | Track 3a | Conflicting 429s, unclear ownership | Extend `ipRateLimit()` only — do NOT add `express-rate-limit` — **corrected in plan** |
| Turn log DELETE-on-insert not atomic | Track 2a plan | Row count exceeds 200 under concurrent inserts | Non-issue: each arena has exactly 200 ticks; natural lifecycle bounds the table. Remove retention logic. |
| Turn log written in `publishTurnRequest` | Track 2a plan | Generic AAP path, not LOB-specific; agentId/action unknown at call site | Write in `lob-orchestrator.ts` tick loop after `waitForLOBSubmission` — **corrected in plan** |
| `arena_turn_log` / `agent_error_log` tables missing | Track 2a/2c | Runtime error on insert | Run `db:generate` + `db:migrate` as explicit step in Track 2a/2c before writing inserts |
| GBM `Math.random()` in test path | `mid-price.ts` | Non-deterministic test failures | Track 1a — injectable RNG, must also add `rng` field to `LOBEngineState` and thread through `processTick` |

### Eng Decision Audit Trail

| ID | Finding | Severity | Decision | Type | Rationale |
|----|---------|----------|----------|------|-----------|
| E-1 | `lob_order_log` insert snippet uses `ts:` (DNE) + omits required `orderId uuid` | CRITICAL | Corrected: use `orderId: crypto.randomUUID()`, omit `createdAt` (auto). Side derived from action type. | Auto | Schema is ground truth; plan snippet was written against stale assumption |
| E-2 | `getRedisClient()` inside `waitForLOBSubmission` while loop (line 295) | HIGH | Hoist `const redis = await getRedisClient()` to before while loop | Auto | Singleton is cached but repeated dynamic import in hot polling path is unnecessary overhead |
| E-3 | Track 3a adds `express-rate-limit` + `rate-limit-redis` — collides with existing `ipRateLimit()` | HIGH | Extend existing `ipRateLimit()` for global + userId-keyed tiers. Do not add new library. | Auto | Boring by default. Two rate limit systems = two 429 code paths, unclear ownership. |
| E-4 | Turn log DELETE-on-insert retention is not atomic under concurrency | MEDIUM | Remove retention logic. Arena lifecycle naturally bounds to 200 rows per arena per agent. | Auto | Essential complexity check: the problem doesn't exist at 200-tick arenas with serial insert |
| E-5 | Turn log write location: plan says `publishTurnRequest` (generic AAP path) | MEDIUM | Write in `lob-orchestrator.ts` tick loop, after `waitForLOBSubmission` returns | Auto | `publishTurnRequest` doesn't have `arenaId`, action, or LOB context. Orchestrator has all of it. |
| E-6 | `arena_turn_log` + `agent_error_log` need migrations before inserts work | MEDIUM | Add explicit `db:generate` + `db:migrate` step to Track 2a/2c execution notes | Auto | Systems over heroes: migrations don't run themselves at 3am |
| E-7 | `LOBEngineState` has no `rng` field; `createLOBEngineState` has no `seed` param | MEDIUM | Add `rng?: () => number` to `LOBEngineState`. `createLOBEngineState(arenaId, agentIds, cash, price, seed?)` uses `mulberry32(seed)` if provided, else `Math.random` | Auto | Plan Track 1a already identifies this; auto-decided implementation detail |
| E-8 | Failure trace write location: plan says `agent-runtime.ts`; LOB timeout is a null return in orchestrator | LOW | Write `agent_error_log` rows in `lob-orchestrator.ts` where `submissions[i] === null` | Auto | Same rationale as E-5 |

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | complete | 6 findings — gate decisions applied |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | complete | Confirmed demand gap, PyPI deferral, portfolio timing |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | complete | 8 findings — all auto-decided |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

**VERDICT:** APPROVED 2026-03-31. Execution underway — Track 0 first.
