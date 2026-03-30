# Phase 9 — SDK Publish · Production Hardening · LOB Arena · Skill Marketplace

**Date:** 2026-03-30
**Branch:** master
**Status:** APPROVED — 2026-03-30, /autoplan pipeline complete (3 phases, 17 auto-decisions + 2 gate decisions)

---

## Context

Phases 1–8 delivered: poker game engine, arena orchestrator, AAP turn protocol, agent-native
onboarding (wallet → session → turn loop), betting system, portfolio page, MarketShell + live
arena detail page, design system polish, `lastProcessedTurnId` crash-resume, thinking upload,
`GameStatusStrip`, and multi-agent equity bar.

This plan covers Phase 9: four parallel tracks in execution priority order.

---

## Priority Order

1. **SDK Publish + Public API** — npm + PyPI distribution, public docs
4. **Production Hardening** — tier/isSmoke API fields, BettingPanel flag removal, matchmaking
2. **LOB Market-Making Arena** — order book game engine, second arena type
3. **Agent Strategy Marketplace + Skill NFT** — NFT minting on wins, marketplace UI

---

## Track 1: SDK Publish + Public API

### Goal

Publish `@agon/agent-skill` (JS CLI) to npm and `agon-sdk` (Python) to PyPI so external
developers can install them with one command. Write a public developer docs site (or at
minimum a docs page in the web app) covering the full onboarding flow.

### Scope

**npm publish (`sdks/agent-skill`)**

- Remove `"private": true` from `package.json`
- Add `"publishConfig": { "access": "public" }` and rename package to `agon-agent-skill`
  (unscoped, friendly for external devs; or keep `@agon/agent-skill` under `@agon` org on npm)
- Add `"prepublishOnly": "node ./tools/sync-public.js"` script
- Bump to `1.0.0` — semver milestone for first stable publish
- Add CI step: `npm publish --dry-run` on PRs, `npm publish` on tag push `v1.*`
- Add `.npmignore` excluding `test/`, `tools/`, `node_modules/`, `*.test.js`

**PyPI publish (`sdks/python`)**

- Verify `pyproject.toml` is complete: `name = "agon-sdk"`, `version = "0.1.0"`
- Add GitHub Actions workflow: `uv build && uv publish` on tag `py-v*`
- Add `PYPI_TOKEN` to repo secrets (manual step — document in README)
- Confirm `python-socketio` and `eth-account` are correct transitive deps

**Public API docs**

- New route `/docs/api` in the web app (or static Markdown rendered via MDX)
- Cover: authentication (SIWE + agent access), arena CRUD, `GET /arenas/:id/runtime`,
  `POST /arenas/:id/actions`, WebSocket events, webhook signature verification
- SDK install instructions for both JS and Python
- Link from landing page hero and from login Agent QuickStart section

**Public API versioning**

- Add `X-API-Version: 1` response header on all `/api/*` routes
- Add deprecation warning headers for any fields removed in future versions
- Document breaking vs. non-breaking change policy in AGENTS.md

### What Already Exists

- `sdks/agent-skill/` — full JS CLI with wallet, session, runtime, turn loop
- `sdks/python/` — Python SDK with `AgentRuntime`, `AgentServer`, `PokerStrategy`
- `sdks/agent-skill/tools/sync-public.js` — syncs to public repo for install.sh flow
- `apps/web/src/app/(auth)/login/page.tsx` — Agent QuickStart expandable section
- Integration tests in `sdks/agent-skill/test/integration.test.js` (5 tests, all passing)

### Not In Scope

- SDK versioning beyond `1.0.0` semver tagging
- SDK changelogs / release notes automation
- Rate limiting on the public API (tracked separately)
- Auth SDK (OAuth/JWT) for human users — separate product concern

### Test Plan

- `npm pack --dry-run` in CI to verify package contents
- `python -m build --check` in CI
- Add one smoke test: install the npm package from tarball, run `agon-agent --version`
- Docs: visual review that `/docs/api` renders correctly in web app

---

## Track 4: Production Hardening

### Goal

Four specific items that clean up rough edges blocking a production-ready platform:
arena tier/isSmoke exposure, BettingPanel flag removal, matchmaking SLA improvements,
and TODOS.md verification for `lastProcessedTurnId`.

### Scope

**4a. Expose `tier` and `isSmoke` in API + types**

Both fields exist in the DB schema and in the arenas route (`tier` exposed at line 183,
`isSmoke` referenced in arena creation). Need to:
- Verify `ArenaInfo` in `packages/types/src/index.ts` includes `tier?: 'practice' | 'micro' | 'serious'`
  and `isSmoke?: boolean` — add if missing
- Confirm `apps/api/src/routes/arenas.ts` serializes both fields in `GET /arenas` and
  `GET /arenas/:id` responses
- Run `pnpm --filter @agon/types typecheck` + `sdks/openclaw`, `sdks/elizaos` typecheck
  to confirm additive (not breaking)

**4b. BettingPanel feature flag removal**

`NEXT_PUBLIC_BETTING_ENABLED` env var gates `BettingPanel` component. Betting is shipped
(Phases 6-7). The flag was a safety net; remove it to clean up dead branches:
- Delete the `if (process.env.NEXT_PUBLIC_BETTING_ENABLED)` conditional in `markets/[id]/page.tsx`
- Remove `NEXT_PUBLIC_BETTING_ENABLED` from any `.env.example` files and Vercel env docs
- Confirm BettingPanel renders correctly without the flag

**4c. Matchmaking SLA improvements**

Current matchmaking: 60s timeout before bot fill, single queue. Issues:
- Agents waiting 60s for a match is too long for a demo / public launch
- No tier-based queue separation (practice agents vs. serious agents match together)
- No match quality metric (ELO delta should be bounded)

Changes:
- Reduce initial wait to 30s before widening ELO window, 60s before bot fill
- Add tier filter: `WHERE tier = $matchTier` on queue scan in `matchmaking.ts`
- Add `elo_delta_max` config (default 400) — widen by 200 every 15s of wait
- Expose queue depth metric: `GET /arenas/queue/depth` returns `{ practice: N, micro: N, serious: N }`

**4d. TODOS.md verification**

The three items in TODOS.md are now either implemented or can be closed:
- Mock test server: DONE (5 integration tests in `sdks/agent-skill/test/integration.test.js`)
- `lastProcessedTurnId` spec: DONE (Redis 24h TTL + DB fallback, dual-write in `agent-runtime.ts`)
- `packages/types` + SDK compat: VERIFY and close (run typecheck on all three packages)

After verification, delete closed items from `TODOS.md`.

### What Already Exists

- `apps/api/src/db/schema.ts` — `tier`, `isSmoke`, `lastProcessedTurnId` all in schema
- `apps/api/src/services/matchmaking.ts` — queue processor with bot fill
- `apps/api/src/services/agent-runtime.ts` — `acceptSubmittedTurn` dual-write
- `apps/api/drizzle/0012_zippy_tiger_shark.sql` — migration for `last_processed_turn_id`
- `packages/types/src/index.ts` — `ArenaInfo` interface (check tier/isSmoke presence)

### Not In Scope

- ELO recalculation system (separate feature)
- Multi-region matchmaking
- Priority queue for premium agents

### Test Plan

- `pnpm --filter @agon/api typecheck` — no new errors
- `pnpm --filter @agon/types typecheck` — additive fields compile
- Manual: create arena with `tier: 'micro'`, confirm field in response
- Manual: remove `NEXT_PUBLIC_BETTING_ENABLED` env var, confirm BettingPanel renders

---

## Track 2: LOB Market-Making Arena

### Goal

Add a second arena type: a Limit Order Book (LOB) market-making game. Agents act as
market makers, posting bids and asks on a synthetic asset. P&L is settled in chips.
This is the bridge to the quant-trading use case in the product vision.

### Scope

**2a. LOB game engine (`apps/api/src/game/lob/`)**

New game engine alongside the poker engine:

```
apps/api/src/game/lob/
  index.ts          — re-exports
  types.ts          — Order, Trade, LOBState, LOBAction
  book.ts           — Limit order book (sorted bids/asks, matching engine)
  pnl.ts            — P&L calculation, mark-to-market, settlement
  engine.ts         — tick() function: advance simulation one step
  mid-price.ts      — synthetic mid-price generator (GBM + mean reversion)
```

LOB types:
```ts
interface Order { id: string; agentId: string; side: 'bid' | 'ask'; price: number; qty: number; ts: number; }
interface Trade { buyerId: string; sellerId: string; price: number; qty: number; ts: number; }
interface LOBState {
  arenaId: string; roundNumber: number; tickNumber: number;
  midPrice: number; spread: number;
  bids: Order[]; asks: Order[];
  recentTrades: Trade[];
  agentInventories: Record<string, number>;  // signed position per agent
  agentCash: Record<string, number>;         // cash per agent
  agentPnl: Record<string, number>;          // mark-to-market P&L
}
interface LOBAction {
  type: 'post_bid' | 'post_ask' | 'cancel' | 'pass';
  price?: number; qty?: number; orderId?: string;
}
```

**2b. LOB orchestrator (`apps/api/src/services/lob-orchestrator.ts`)**

Parallel to `orchestrator.ts` but for LOB arenas:
- Tick loop: **1000ms per tick** (default), 200 ticks per round. Arena creators may set `tickIntervalMs: 500` for speed arenas.
- Each tick: emit mid-price update to all agents, collect actions, execute book matching
- AAP integration: same turn-request / action-submit pattern as poker
- Settlement: at round end, convert inventory to cash at last mid-price, update chip stacks

**2c. Schema additions**

```sql
-- In drizzle schema:
lob_order_log: { id, arenaId, roundNumber, tickNumber, agentId, side, price, qty, orderId, ts }
lob_trade_log: { id, arenaId, roundNumber, tickNumber, buyerId, sellerId, price, qty, ts }
```

Add `gameType: 'texas_holdem' | 'lob_market_making'` to `ArenaInfo` (already in schema as `gameType`).

**2d. LOB arena creation API**

- `POST /arenas` accepts `gameType: 'lob_market_making'` with `tickIntervalMs`, `numTicks`,
  `startingCash`, `startingInventory`
- Validation: reject non-LOB params (smallBlind, bigBlind) when gameType is LOB

**2e. LOB visualization (frontend)**

The `VisualizationRegistry` in `markets/[id]/page.tsx` already has `lob_market_making` as
`ComingSoonVisualization`. Replace with actual LOB viz:
- Live order book depth (bid/ask ladder, color-coded)
- Mid-price chart (rolling 50-tick window)
- Agent P&L strip (real-time)
- Existing `PnLChart.tsx` can be adapted for the mid-price series

**2f. Agent turn request shape for LOB**

Add to `packages/types/src/index.ts`:
```ts
interface LOBTurnRequest {
  turnId: string; arenaId: string; roundNumber: number; tickNumber: number;
  agentId: string; midPrice: number; spread: number;
  myOrders: Order[]; myInventory: number; myCash: number; myPnl: number;
  bids: Order[]; asks: Order[];
  validActions: LOBActionType[];
  deadlineMs: number;
  submitPath: string;
}
type LOBActionType = 'post_bid' | 'post_ask' | 'cancel' | 'pass';
```

### What Already Exists

- `apps/web/src/app/(market)/markets/[id]/page.tsx` — `VisualizationRegistry` with LOB stub
- `apps/api/src/db/schema.ts` — `gameType` column in arenas table
- `apps/api/src/services/orchestrator.ts` — poker orchestrator to pattern-match
- `apps/api/src/services/agent-runtime.ts` — AAP turn protocol (reuse for LOB turns)
- `packages/types/src/index.ts` — `AgentTurnRequest` pattern to extend

### Not In Scope

- Real market data feeds (use synthetic GBM mid-price)
- Options or futures instruments
- Multi-asset books
- LOB betting (separate feature)
- ELO/ranking for LOB agents (add post-MVP)

### Test Plan

- Unit tests for `book.ts`: price-time priority matching, partial fills, cancel
- Unit tests for `mid-price.ts`: GBM bounds, mean-reversion tendency
- Unit tests for `pnl.ts`: inventory mark-to-market, flat PnL at start
- Integration test: two mock agents post crossing orders, trade executes, P&L updates
- `pnpm --filter @agon/api typecheck` — no errors
- `pnpm --filter @agon/types typecheck` — LOBTurnRequest compiles

---

## Track 3: Global Leaderboard

**Scope reduced at gate:** NFT minting, IPFS, ERC-1155, marketplace infrastructure deferred to Phase 10.
Only the leaderboard ships in Phase 9. Both CEO and design reviews independently recommended this.

### Goal

A `/leaderboard` page showing top agents ranked by ELO, win rate, and total chips won.
Pure query on existing data — no new schema required.

### Scope

**3a. Leaderboard API**

```
GET /leaderboard?metric=elo|win_rate|total_chips_won&period=all|30d|7d&limit=50&offset=0
```

- Shell: `ConsoleShell`
- `metric` param validated against `VALID_METRICS` allowlist (SQL injection prevention)
- `period` filter: `all` = no date filter; `30d`/`7d` = filter by `arenas_finished.createdAt`
- No authentication required (public leaderboard)

**3b. Leaderboard UI**

New route: `/leaderboard` (ConsoleShell)
- `PageHeader` with `PageHeader` eyebrow "RANKINGS" + description
- Tab pills: ELO Rating / Win Rate / Chips Won
- Table: rank #, `EntityAvatar`, agent name, owner, primary metric, secondary stats
- All numeric data cells: `var(--font-mono)` with `letter-spacing: +0.10em`
- `EmptyState` for zero results: "No arena results yet"
- Mobile: cards at <768px (not table) — see D-7
- Time filter pills: All Time / 30 Days / 7 Days

**3c. API route**

`apps/api/src/routes/leaderboard.ts` — new file.
Queries `schema.agents` on `eloRating`, `handsWon`, `totalChipsWon`.
Joins `schema.arenaSeats` for period filter.

### What Already Exists

- `agents.eloRating`, `agents.handsWon`, `agents.totalChipsWon` — all in schema
- `EntityAvatar`, `StatusBadge`, `SurfaceCard`, `EmptyState`, `PageHeader` — in `chrome.tsx`
- ConsoleShell — already the correct shell for this route

### Not In Scope (Phase 3 only)

- NFT minting, IPFS, ERC-1155 contract — deferred to Phase 10
- Marketplace UI — deferred to Phase 10
- Agent profile NFT collection tab — deferred to Phase 10
- Secondary market mechanics — deferred

### Test Plan

- `GET /leaderboard?metric=elo` → sorted by `eloRating` descending
- `GET /leaderboard?metric=invalid` → 400
- `GET /leaderboard?period=30d` with no results → empty array, not 500
- SQL injection: `metric='; DROP TABLE agents; --` → 400 (allowlist)
- Visual: page renders in web app with empty state and with data

---

## Execution Order

```
Week 1: Track 1 (SDK publish) + Track 4 (production hardening) — parallel
Week 2: Track 2 (LOB engine + API) — main engineering work
Week 3: Track 2 (LOB frontend) + Track 3 (NFT + marketplace) — parallel
```

Tracks 1 and 4 are independent of each other and of Tracks 2/3.
Track 3 depends on Track 1 (public API) being done first for NFT metadata hosting.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LOB tick loop conflicts with poker orchestrator | Medium | High | Separate orchestrator services, no shared state |
| Base L2 gas costs spike at mint time | Low | Medium | Batch minting with 24h delay; skip mint if gas > threshold |
| npm package name `agon-agent-skill` taken | Low | Low | Check availability before publish; fallback to `@agon/agent-skill` |
| LOB agent latency (500ms tick too fast) | Medium | Medium | Configurable `tickIntervalMs`; default 1000ms for practice |
| IPFS pinning Pinata outage | Low | Low | Store metadata in DB as fallback; IPFS is optional enhancement |

---

## Success Metrics

- Track 1: `npm install agon-agent-skill` installs and `agon-agent --version` runs
- Track 4: Zero `NEXT_PUBLIC_BETTING_ENABLED` references remain in codebase
- Track 2: Two-agent LOB arena completes 200 ticks, P&L settles correctly
- Track 3: `/leaderboard` renders with top-50 agents, sorted by ELO

---

---

## Phase 1: CEO Review

### Premise Challenge

**P1. Assumption: Developer audience exists for `agon-agent-skill` npm publish.**
The plan treats publication as the end goal without validating demand. No waitlist, no beta users referenced.
Auto-decision: ACCEPT the challenge. Add private beta gate (3-5 known developers must connect before public npm publish). This is a sequencing change, not scope cut.

**P2. Assumption: 500ms tick LOB is the right design without developer validation.**
Real market-making agents need backtesting, historical replay, risk controls. GBM price process without statistical structure → trivially exploitable.
Auto-decision: ACCEPT. Note the risk in the LOB track. Configurable `tickIntervalMs` default raised to 1000ms with note that 500ms is opt-in. No scope change.

**P3. Assumption: Skill NFTs create engagement.**
In 2026, NFT marketplaces have demonstrated no durable engagement. The leaderboard (Track 3d) is the actual engagement mechanic.
Auto-decision: ACCEPT. Flag as a taste risk. See decision D-4 below — NFT track restructured.

**P4. Assumption: Track 4 can run in parallel with Track 1.**
BettingPanel flag removal and TODOS verification affect the API surface that SDK connects to. Track 4 items that touch API responses must complete before Track 1 publish.
Auto-decision: ACCEPT. Revise execution order: Track 4 API items gate Track 1.

**P5. Assumption: LOB + NFT can both ship in Week 3.**
LOB frontend + full NFT marketplace track is 4-6 weeks of real work crammed into one week.
Auto-decision: ACCEPT. Split into two weeks. NFT track reduced.

### What Already Exists

Confirmed by code inspection:
- Matchmaking: `apps/api/src/services/matchmaking.ts` — Redis sorted set queue, 60s SLA, bot fill
- LOB stub: `VisualizationRegistry` in `markets/[id]/page.tsx` has `lob_market_making` → `ComingSoonVisualization`
- `AgentTurnRequest` in `packages/types/src/index.ts` — extend pattern for LOB
- `ArenaInfo.gameType` in types and schema — already supports multiple game types
- `tier` already serialized in arenas route line 183
- `lastProcessedTurnId`: Redis dual-write done in `agent-runtime.ts`, DB column in `0012` migration
- Betting panel: `NEXT_PUBLIC_BETTING_ENABLED` guard in `markets/[id]/page.tsx`
- Python SDK: `agon-sdk` in `sdks/python/pyproject.toml` with hatchling build

### NOT In Scope (added by CEO review)

- Community/distribution strategy (Discord, developer outreach) — execution, not engineering
- Secondary market price discovery for NFTs
- Backtesting infrastructure for LOB agents
- Historical LOB data export API
- Rate limiting on public API (tracked separately, blocks full public launch)
- ELO recalculation system (pre-existing deferral, matchmaking ELO bounds removed per D-3)

### Error & Rescue Registry

| Failure | Likelihood | Rescue |
|---------|-----------|--------|
| SDK ships, zero external agents connect | High | Private beta gate before public npm publish |
| LOB tick too fast for agent response | Medium | Default `tickIntervalMs: 1000`, opt-in 500ms |
| IPFS/Pinata outage corrupts NFT metadata | Low | DB fallback metadata storage (already in plan) |
| ELO-bounded matchmaking without calibrated ELO | High | Remove ELO bounds from Track 4 (D-3) |
| Week 3 over-commitment | High | NFT track reduced to leaderboard-only (D-4) |

### Failure Modes Registry

| Mode | Where | Impact | Mitigation |
|------|-------|--------|-----------|
| No demand validated before SDK publish | Track 1 | Zero adoption | Private beta gate |
| LOB bot latency mismatch | Track 2 | Unfair arena outcomes | Configurable tick speed |
| Smart contract exploit | Track 3 (if NFTs built) | User funds at risk | Defer to Phase 10 |
| matchmaking ELO bounds without calibrated ratings | Track 4 | Bad match quality | Remove bounds (D-3) |
| BettingPanel visible before API cleanup | Track 4 → Track 1 | Inconsistent UX | Gate SDK on Track 4 |

### Dream State Delta

In 6 months: 50+ external agent developers running strategies in poker + LOB arenas, platform has reputation in AI-quant-adjacent developer community. Gap vs. this plan:
- No community/distribution strategy (out of scope for this plan — separate effort)
- No structured error codes for SDK debugging (added to Track 1 scope: D-5)
- No historical LOB data API (deferred to Phase 10)
- Leaderboard ships in Track 3 as standalone, not coupled to NFTs

### CEO DUAL VOICES

**CLAUDE SUBAGENT (CEO — product challenge):**

Key findings (severity ≥ High):
- Critical: No developer demand validation before SDK publish → private beta gate
- Critical: LOB tick speed not validated → configurable, default 1000ms
- High: Week 3 is two full products → NFT track cut to leaderboard only
- High: SDK published before LOB exists → write explicit v1 scope for devs
- High: ELO matchmaking bounds without ELO system → remove ELO bounds from Track 4
- High: No structured error codes for SDK DX → add to Track 1
- High: NFT engagement assumption unvalidated → leaderboard decoupled from NFTs

**CODEX SAYS (CEO — architecture challenge):**
Unavailable — Codex session required re-authentication during this run (login prompt blocked execution). Source = subagent-only.

### CEO CONSENSUS TABLE

```
CEO DUAL VOICES — CONSENSUS TABLE (source: subagent-only):
═══════════════════════════════════════════════════════════════════════
  Dimension                            Claude    Codex     Consensus
  ─────────────────────────────────── ──────── ────────── ──────────
  1. Developer demand validated?        FAIL     N/A        FLAGGED
  2. LOB design sound for v1?           RISK     N/A        FLAGGED
  3. NFT track rightly scoped?          NO       N/A        FLAGGED
  4. Priority order correct?            PARTIAL  N/A        PARTIAL
  5. Missing critical feature?          YES(err) N/A        FLAGGED
  6. Execution timeline realistic?      NO       N/A        FLAGGED
═══════════════════════════════════════════════════════════════════════
NOTE: Codex unavailable (auth). Single-voice review. All flagged items
auto-decided; surfaced critical ones at gate.
```

### Phase 1 Completion Summary

CEO review complete (Claude subagent). 7 findings identified, 5 auto-decided, 2 surfaced for user:

**Auto-decisions (D-1 to D-5 below):**
1. Private beta gate added before public npm publish
2. NFT track reduced: leaderboard ships in Track 3; full NFT infrastructure deferred to Phase 10
3. ELO matchmaking bounds removed from Track 4
4. Track 4 API items gate Track 1 (sequencing fix)
5. Structured error codes added to Track 1 scope

**Taste risks (surfaced at gate):**
- LOB tick speed: 1000ms default is conservative; whether to support 500ms opt-in is a product call
- SDK v1 scope statement: what to tell developers about LOB availability timing

---

---

## Phase 2: Design Review

### Critical Finding — LOB Visualization Already Exists

`LOBVisualization.tsx` is fully implemented — order book ladder, sparkline, agent feed, skeleton loader, live/finished/simulated states, full CSS in `globals.css`. The plan incorrectly treats this as future work. Track 2 "LOB frontend" scope is therefore: (a) wire to real socket data instead of mock, (b) implement per-agent P&L strip, (c) apply the three must-fix items below. Significantly less work than building from scratch.

Auto-decision: Update Track 2e scope accordingly. (D-6)

### 7 Dimensions Evaluation

| Dimension | Score | Issue | Fix |
|---|---|---|---|
| 1. Information hierarchy | 7/10 | Per-agent P&L absent from top-level LOB view | Add P&L summary row to topbar |
| 2. Design consistency | 8/10 | Shell assignments unspecified for `/leaderboard` and `/docs/api` | Leaderboard → ConsoleShell, Docs → BrandShell |
| 3. Empty/loading states | 9/10 | Leaderboard empty state unspecified | Use `EmptyState` component; copy: "No arena results yet" |
| 4. Typography | 9/10 | Leaderboard numeric data cells not spec'd as mono | All numeric columns → `var(--font-mono)` |
| 5. Color semantics | 9/10 | P&L strip color rule not explicit | P&L+: `--green`, P&L-: `--red`, zero: `--ink-faint` |
| 6. Mobile / responsive | 4/10 | LOB 4-col book + leaderboard table both hostile on mobile | Cap LOB to 5 levels/3 cols on <640px; leaderboard → cards on <768px |
| 7. Interaction model | 5/10 | No pause-on-hover; mock data runs unconditionally on LIVE arenas | Hover-to-pause on order book; disable mock animation when `isLive` |

**Composite: 7.3/10**

### Three Must-Fix Items

**M1 (Mobile):** LOB order book needs 3-column/5-level layout on <640px. Leaderboard degrades to cards on <768px. Neither addressed in plan.
Auto-decision: Add to Track 2e and Track 3d implementation requirements. (D-7)

**M2 (Pause-on-hover):** `setInterval` 800ms update makes the order book unreadable. Hover pauses update loop; mouse-leave resumes. ~5 lines, outsized UX value.
Auto-decision: Add to Track 2e scope. (D-8)

**M3 (Mock/live conflation):** `LOBVisualization.tsx` runs mock animation even when `isLive=true`. When connected to real arena, disable the mock perturbation engine and let real socket data drive updates.
Auto-decision: Engineering concern — add to Track 2 eng requirements. (D-9)

### Design Litmus Scorecard

```
DESIGN LITMUS:
  Score: 7.3/10
  Blocking: Mobile (4/10) + Interaction (5/10)
  Must-fix before shipping: M1, M2, M3 (above)
  Nice-to-have: shimmer animation on skeletons, sparkline tooltip
```

### Phase 2 Completion Summary

Design review complete (Claude subagent, Codex unavailable). Composite 7.3/10. 4 auto-decisions (D-6 to D-9). No taste decisions — all design issues have clear correct answers per DESIGN.md.

**Critical discovery:** LOB frontend is already built. Track 2 frontend scope is significantly smaller than planned.

---

## Phase 3: Eng Review

### Scope Challenge — What Already Exists vs. What the Plan Claims

| Planned Component | Actual Status | Gap |
|---|---|---|
| `game/lob/book.ts` | Does not exist | Build |
| `game/lob/engine.ts` | Does not exist | Build |
| `game/lob/pnl.ts` | Does not exist | Build |
| `lob-orchestrator.ts` | Does not exist | Build |
| `LOBVisualization.tsx` | **Already exists** | Wire to socket only |
| `gameTypeEnum` in schema | Only `'texas_holdem'` (schema.ts:21) | **Blocker — migration needed** |
| `ArenaInfo.gameType` in types | `'texas_holdem'` hardcoded (types:225) | Must add LOB value |
| `POST /arenas/:id/actions` action schema | Zod enum: fold/check/call/raise/all_in (arenas.ts:54) | **Blocker — rejects LOB verbs** |
| `acceptSubmittedTurn` validation | Validates against poker `validActions` (agent-runtime.ts:201) | **Blocker — rejects LOB actions** |
| `AgentRuntimeSnapshot.privateState` | `GameState | null` (types:133) | LOB agents receive null |
| `QueueEntry` | No `tier` field (matchmaking.ts:37-43) | Tier filter breaks existing queue |
| Leaderboard API | Does not exist | Build |
| `lob_order_log` / `lob_trade_log` tables | Do not exist | Migration needed |

### Architecture ASCII Diagram

```
apps/api/src/game/lob/
  types.ts ←──────────────────────────────── pure types, no deps
  book.ts ←── types.ts                       order book matching
  mid-price.ts ←── types.ts                  GBM synthetic price
  pnl.ts ←── types.ts, book.ts               mark-to-market, settlement
  engine.ts ←── book.ts, mid-price.ts, pnl.ts  tick() fn
  index.ts ←── re-exports all

apps/api/src/services/lob-orchestrator.ts
  ←── game/lob/index.ts           (tick engine)
  ←── agent-runtime.ts            (publishTurnRequest — MODIFIED: must be parallel)
  │    └── redis.ts               (setAgentPendingTurn — SHARED key space with poker)
  ←── db/schema.ts                (lob_order_log, lob_trade_log — NEW)
  ←── io.ts                       (Socket.IO broadcast)
  ←── kafka.ts                    (publishEvent)
  ←── chip.ts                     (settlement)

⚠ COUPLING: agent-runtime.ts is shared between orchestrator.ts (poker) and
  lob-orchestrator.ts. Redis key space: agent:pending:<arenaId>:<agentId>
  — arena-scoped, no collision. BUT: AgentRuntimeSnapshot.privateState is
  typed as GameState | null — must be extended for LOB.

⚠ BLOCKER: POST /arenas/:id/actions Zod schema (arenas.ts:54) is poker-only.
  LOB needs either: new route /arenas/:id/lob-actions OR game-type dispatch.
  New route is cleaner and avoids touching the hot poker action path.
```

### Three Architectural Blockers (must fix before LOB code ships)

**Block-1:** `pgEnum('game_type', ['texas_holdem'])` at schema.ts:21.
Adding `'lob_market_making'` requires `ALTER TYPE ... ADD VALUE` migration.
Auto-decision: Add to Track 2 scope as first task. Generate via `db:generate`. (D-10)

**Block-2:** `POST /arenas/:id/actions` Zod + `acceptSubmittedTurn` are poker-only.
LOB actions (`post_bid`, `post_ask`, `cancel`, `pass`) will be rejected with 400.
Auto-decision: New route `POST /arenas/:id/lob-actions` with LOB Zod schema + new `acceptLOBTurn` function. Avoids touching poker action path. (D-11)

**Block-3:** `waitForSubmittedTurn` called sequentially — agent B gets unfair reduced time.
LOB needs parallel turn collection: `Promise.all([waitFor(A), waitFor(B)])` with shared deadline.
Auto-decision: `lob-orchestrator.ts` must use parallel collection. Document explicitly in implementation. (D-12)

### Additional High-Priority Findings

**H-1:** `AgentRuntimeSnapshot.privateState: GameState | null` — LOB agents receive null from `/arenas/:id/runtime`. Add `lobState?: LOBState | null` to `AgentRuntimeSnapshot`. Auto-decision: Add to Track 2 types scope. (D-13)

**H-2:** `QueueEntry` has no `tier` field — matchmaking tier filter as described in Track 4 cannot be a DB WHERE clause; `tier` is computed at query time, not stored. Existing queue entries without `tier` will silently fail to match. Auto-decision: Add `tier` to `QueueEntry` struct in matchmaking.ts; validate on arena join; handle missing field with `practice` default. (D-14)

**H-3:** LOB mid-price not persisted between ticks — if `lob-orchestrator` crashes on tick 137, `LOBState.midPrice` is lost, settlement fails. Must write `lastMidPrice` to Redis (24h TTL) after each tick. Auto-decision: Add to `lob-orchestrator.ts` implementation requirements. (D-15)

**H-4:** `tools/` in `package.json "files"` whitelist — `sync-public.js` may contain repo credentials. Must remove `tools/` from whitelist. Auto-decision: Fix in Track 1. (D-16)

**H-5:** Leaderboard `metric` query param must be validated against an allowlist before any SQL construction — SQL injection risk. Auto-decision: Enforce `VALID_METRICS` allowlist in route handler. (D-17)

### Test Coverage Map

| Codepath | Test Needed | Priority |
|---|---|---|
| `book.ts`: crossing order immediate match | Unit | Critical |
| `book.ts`: cancel nonexistent order ID | Unit | High |
| `engine.ts`: tick() with zero agent submissions (timeout path) | Unit | Critical |
| `pnl.ts`: settlement with no trades (GBM-only mid-price) | Unit | High |
| `pnl.ts`: negative inventory settlement | Unit | High |
| `lob-orchestrator.ts`: arena ends mid-tick | Integration | High |
| `lob-orchestrator.ts`: one agent crashes mid-game | Integration | High |
| `lob-orchestrator.ts`: two agents post crossing orders, trade executes | Integration | High (plan has this) |
| Leaderboard: `metric` param with unrecognized value → 400 | Unit | High |
| Leaderboard: `period=30d` with no rows | Unit | Medium |
| `POST /arenas/:id/lob-actions`: agent submitting for another agent's ID → 403 | Unit | Critical |
| LOB turn loop: parallel `Promise.all` timing test | Integration | High |
| SDK publish: `npm pack --dry-run` excludes `tools/` | CI | High |

### NOT In Scope (eng additions)

- `waitForSubmittedTurn` refactor for poker (sequential is correct for poker — LOB gets its own parallel variant)
- Historical LOB data export API
- ELO recalculation system
- LOB backtesting environment
- `AgentArenaEvent` type extension for LOB events (additive, can land post-ship)

### What Already Exists (eng confirmation)

- `agent-runtime.ts`: `publishTurnRequest`, `waitForSubmittedTurn`, `acceptSubmittedTurn` — all reusable with modifications
- `chip.ts`: settlement helpers — reusable for LOB chip adjustments
- `kafka.ts`: `publishEvent` — reusable for LOB game events
- `VisualizationRegistry` in `page.tsx:65` — `lob` key already defined, needs component swap

### Failure Modes Registry (Eng additions to CEO list)

| # | Mode | File:Line | Mitigation |
|---|------|-----------|------------|
| FM-E1 | `gameTypeEnum` missing LOB value | schema.ts:21 | Migration before LOB ships |
| FM-E2 | Zod schema rejects LOB actions | arenas.ts:54 | New LOB action route |
| FM-E3 | Sequential turn collection unfair | agent-runtime.ts:147 | `Promise.all` in lob-orchestrator |
| FM-E4 | `lastMidPrice` not persisted | lob-orchestrator (unbuilt) | Redis write per tick |
| FM-E5 | LOB agents get null `privateState` | types:133 | Add `lobState` to snapshot |
| FM-E6 | `acceptSubmittedTurn` rejects LOB | agent-runtime.ts:201 | New `acceptLOBTurn` |
| FM-E7 | `QueueEntry` tier field missing | matchmaking.ts:37-43 | Add field + default |
| FM-E8 | `tools/` in npm "files" whitelist | package.json:17 | Remove from whitelist |
| FM-E9 | Leaderboard SQL injection | leaderboard route (unbuilt) | Allowlist validation |
| FM-E10 | LOB crash-resume missing mid-price | lob-orchestrator (unbuilt) | Redis persistence per tick |

### ENG DUAL VOICES

**CLAUDE SUBAGENT (Eng — independent review):**
10 failure modes identified, 3 architectural blockers, 2 security requirements. See above.

**CODEX SAYS (Eng — architecture challenge):**
Unavailable — auth session required (same issue as CEO phase). Source: subagent-only.

### ENG CONSENSUS TABLE

```
ENG DUAL VOICES — CONSENSUS TABLE (source: subagent-only):
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               PARTIAL  N/A    FLAGGED
  2. Test coverage sufficient?         NO       N/A    FLAGGED
  3. Performance risks addressed?      YES      N/A    OK
  4. Security threats covered?         PARTIAL  N/A    FLAGGED
  5. Error paths handled?              NO       N/A    FLAGGED
  6. Deployment risk manageable?       PARTIAL  N/A    PARTIAL
═══════════════════════════════════════════════════════════════
NOTE: Codex unavailable. Single-voice review.
```

### Phase 3 Completion Summary

Eng review complete. 10 failure modes, 3 architectural blockers, 8 auto-decisions (D-10 to D-17).

**Auto-decisions:** All 8 are clear engineering requirements with no ambiguity — added to plan scope.

**No taste decisions at eng phase** — all findings have unambiguous correct answers (enum extension, new route, parallel collection, allowlist validation).

---

### Cross-Phase Themes

1. **LOB type system is incomplete end-to-end** (Phase 1: "reuse AAP protocol" is too vague; Phase 3: 3 specific type blockers). Both phases independently flagged that LOB integration requires more work than "reuse existing." High-confidence signal.

2. **LOB frontend scope was overstated** (Phase 2: already built; Phase 3: confirmed VisualizationRegistry already has LOB entry). Plan's Track 2 frontend estimate is too high. Both phases agree. Reduces Week 3 load.

3. **Sequential processes in a concurrent world** (Phase 1: "both agents must submit simultaneously"; Phase 3: `waitForSubmittedTurn` is sequential). Same root issue, independently identified. Fix: `Promise.all` in `lob-orchestrator`.

---

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| D-1 | CEO | Private beta gate: 3-5 developers must connect before public npm publish | Scope addition | P2 (never reduce) | Demand validation is non-optional before public distribution | No gate (publish immediately) |
| D-2 | CEO | NFT track reduced: Track 3 = leaderboard only; NFT minting + marketplace deferred to Phase 10 | Scope reduction | P3 (user value) | NFT engagement unvalidated; leaderboard has clear value; saves 4-6 weeks | Full NFT track as planned |
| D-3 | CEO | ELO matchmaking bounds removed from Track 4 | Scope reduction | P4 (explicit > clever) | ELO bounds without calibrated ratings are misleading; adds complexity without correctness | ELO delta_max: 400 as planned |
| D-4 | CEO | Track 4 API items (tier/isSmoke, BettingPanel) complete before Track 1 SDK publish | Sequencing fix | P5 (dependencies explicit) | SDK connects to API; inconsistent API state during publish creates bad first impression | True parallel as planned |
| D-5 | CEO | Add structured error codes to Track 1 scope: `code`, `message`, `retryable` on all API errors | Scope addition | P2 (never reduce) | Single biggest DX gap for agent-native platform; without this, SDK debugging is blind | Defer error codes |
| D-6 | Design | Update Track 2e LOB frontend scope: wire LOBVisualization.tsx to real socket + P&L strip + mobile fixes (NOT build from scratch — already built) | Scope clarification | P4 (explicit) | Design review confirmed component fully exists; plan was wrong about scope | Rebuild from scratch |
| D-7 | Design | Add mobile requirements to Track 2e and Track 3d: LOB 3-col/5-level on <640px; leaderboard cards on <768px | Scope addition | P2 (never reduce) | Both views are mobile-hostile as specified; must fix before production | Defer mobile |
| D-8 | Design | Add hover-to-pause to LOB order book (pause `setInterval` on mouse-over) | Scope addition | P3 (user value) | 800ms auto-update makes book unreadable; 5-line fix, outsized UX impact | No pause control |
| D-9 | Design | Disable mock animation in LOBVisualization when `isLive=true` | Scope addition | P4 (explicit > clever) | Mock data running on a live arena is a trust problem; spectators can't tell signal from noise | Keep mock animation always |
| D-10 | Eng | Extend `gameTypeEnum` in schema.ts:21 to include `'lob_market_making'` + migration | Blocker fix | P5 (dependencies explicit) | Without this, LOB arenas cannot be created at DB layer | Ship LOB without migration |
| D-11 | Eng | New route `POST /arenas/:id/lob-actions` with LOB Zod schema + `acceptLOBTurn` function | Blocker fix | P4 (explicit) | Poker Zod schema and `acceptSubmittedTurn` reject all LOB action verbs; new route is cleaner | Modify existing poker route |
| D-12 | Eng | LOB turn collection uses `Promise.all` across all agents per tick (not sequential) | Blocker fix | P3 (user value) | Sequential collection gives agent B unfair reduced deadline; breaks fairness | Sequential reuse of poker pattern |
| D-13 | Eng | Add `lobState?: LOBState \| null` to `AgentRuntimeSnapshot` in types/index.ts:133 | Scope addition | P2 (never reduce) | LOB agents receive null `privateState` from /runtime — unusable | Union type on existing privateState |
| D-14 | Eng | Add `tier` field to `QueueEntry` in matchmaking.ts; default missing field to `practice` | Scope addition | P4 (explicit) | `tier` is computed not stored; tier filter cannot be DB WHERE clause; existing entries break | Use computed tier in WHERE clause |
| D-15 | Eng | Write `lastMidPrice` to Redis (24h TTL) after each LOB tick in lob-orchestrator | Scope addition | P2 (never reduce) | Without persistence, crash on tick 137 loses settlement price; cannot recover | Compute at settlement only |
| D-16 | Eng | Remove `tools/` from `package.json "files"` whitelist in agent-skill | Security fix | P6 (explicit security) | `sync-public.js` may contain credentials; current whitelist publishes it to npm | Keep tools/ in package |
| D-17 | Eng | Leaderboard `metric` param must be validated against VALID_METRICS allowlist before SQL | Security fix | P6 (explicit security) | SQL injection via unvalidated query param | Drizzle type safety is sufficient |
| D-18 | Gate | Drop NFT infrastructure entirely from Phase 9; Track 3 = leaderboard only | Scope reduction | P3 (user value) | User confirmed: both review voices agreed NFT demand unvalidated, leaderboard has clear value, saves 4-6 weeks | Keep full NFT track |
| D-19 | Gate | LOB tick speed: 1000ms default, 500ms opt-in via `tickIntervalMs` arena param | Spec clarification | P3 (user value) | User confirmed: more agent-friendly default, speed arenas opt-in | 500ms fixed |

