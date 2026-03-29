# Plan: Market-Based Arena Platform Redesign

> Source PRD: [Airine/agon-arena#1](https://github.com/Airine/agon-arena/issues/1)

## Architectural Decisions

Durable decisions that apply across all phases:

- **Routes**:
  - `/markets` — arena discovery (replaces `/arenas`)
  - `/markets/[id]` — live arena + betting (replaces `/arenas/[id]`)
  - `/agents` — agent leaderboard as investment entry (keep, update framing)
  - `/agents/[id]` — agent detail + shares (keep, update content)
  - `/portfolio` — user holdings (new)
  - `/dashboard` — owner/builder console (keep, update)
  - `/login` — auth, absorbs `/register` (keep, update)
  - `/settings` — account settings (keep)
  - DELETE: `/for-agents`, `/docs/agent-quickstart`, `/register`

- **Shells** (two shells replace current three):
  - `MarketShell` — wraps `/markets`, `/markets/[id]`, `/agents`, `/agents/[id]`, `/portfolio`. Fixed nav bar, full-width layout, dark grain overlay, inherits landing visual DNA.
  - `ConsoleShell` — wraps `/dashboard`, `/settings`. 280px sidebar, no grain, clean work surface. Visual tokens aligned with MarketShell.
  - Landing (`/`) stays unchanged.

- **Arena type registry**: `arenaTypes.ts` maps `gameType` string → `ArenaVisualization` component. Each component implements a shared `ArenaVisualizationProps` interface (`arenaId`, `gameState`, `agents`, `isLive`). Keeps visualization concerns isolated from arena data fetching.

- **Schema additions** (cumulative across phases):
  - `arena_bets` — single-match bets (userId, arenaId, agentId, amount, odds, status)
  - `agent_shares` — share configuration per agent (totalSupply, ownerShareRate, currentPrice)
  - `share_holdings` — per-user holdings (userId, agentId, sharesOwned, avgCost, dividendsReceived)
  - `share_transactions` — buy/sell log
  - `dividend_distributions` — per-arena distribution records

- **Chip system**: All monetary values (bets, shares, dividends) use the existing `chipBalance` / `chipTransactions` ledger. No new currency. `arena_bets.amount` and share prices are denominated in CHIP.

- **Authentication**: All existing auth flows (email, GitHub, Google, Twitter, SIWE) remain. `/register` UI merges into `/login` — no backend auth changes required.

- **gameType enum**: Expand from `'texas_holdem'` to include `'werewolf'`, `'debate'`, `'auction'`, `'lob'` (placeholder), `'territory'` (placeholder) across phases 5+.

---

## Phase 1: MarketShell + Markets Discovery

**User stories**: 1–7, 50–53

### What to build

Introduce `MarketShell` as the new shell for all public-facing market and agent pages. Build `/markets` as the primary arena discovery page with Polymarket-style arena cards.

Each arena card surfaces prize pool (ETH/CHIP) as the hero metric, with game type badge, agent count, status pill (LIVE / UPCOMING / ENDED), total bets volume, and time remaining. The page supports filtering by game type and status, and sorting by prize pool / bets / ending soonest.

Delete `/for-agents` and `/docs/agent-quickstart` pages and routes. Remove all internal links pointing to them.

The existing `/arenas` route redirects to `/markets`.

### Acceptance criteria

- [ ] `MarketShell` renders with fixed nav (blur on scroll), dark background, grain overlay, gold accent — visually continuous with the landing page
- [ ] `/markets` lists all arenas using the new card design; prize pool is the largest typographic element on each card
- [ ] Game type badge, status pill, agent count, and time remaining are visible on every card
- [ ] Filter by game type and status works; sort by prize pool / bets / ending soonest works
- [ ] `/for-agents` and `/docs/agent-quickstart` return 404; no broken internal links remain
- [ ] `/arenas` redirects to `/markets`
- [ ] `pnpm --filter @agon/web typecheck` and `lint` pass

---

## Phase 2: Live Arena Detail (`/markets/[id]`)

**User stories**: 8–12

### What to build

New `/markets/[id]` route replacing `/arenas/[id]`. Establishes the arena visualization registry pattern: `arenaTypes.ts` maps `gameType` → visualization component. V1 registers `PokerTableVisualization` (ported from existing arena page) and a generic `ComingSoonVisualization` fallback.

Page layout: visualization canvas (center/main), live agent leaderboard (right sidebar), agent action feed (bottom panel or left rail). All panels update via the existing Socket.IO connection.

The existing `/arenas/[id]` route redirects to `/markets/[id]`.

### Acceptance criteria

- [ ] `/markets/[id]` renders the poker table visualization for `texas_holdem` arenas
- [ ] Live leaderboard shows each agent's current chip count, updating in real time
- [ ] Agent action feed shows the last N actions (fold/call/raise/etc.) with agent name and amount
- [ ] Unknown game types render the `ComingSoonVisualization` fallback without error
- [ ] `/arenas/[id]` redirects to `/markets/[id]`
- [ ] Completed arenas show a "Match ended" state with final standings
- [ ] `pnpm --filter @agon/web typecheck` and `lint` pass

---

## Phase 3: ConsoleShell Visual Alignment + Owner Console

**User stories**: 34–40

### What to build

Align `ConsoleShell` visual tokens with `MarketShell` so navigating from `/markets` to `/dashboard` doesn't feel like a different product. Shared token updates: same gold accent (`--gold`), same Syne 800 section headings, same 0.5px hairline borders, same `--bg` / `--bg2` surfaces.

Update `/dashboard` to show the owner's agents with current status (in arena / idle / offline), total earnings, and win statistics. Each agent card links to `/agents/[id]`.

Add a shares configuration placeholder UI on the agent card (static, no backend yet — wired up in Phase 8).

### Acceptance criteria

- [ ] `ConsoleShell` sidebar and main area use the same `--gold`, `--bg`, `--border` tokens as `MarketShell`
- [ ] Active sidebar link has a gold left-border indicator (3px solid `--gold`)
- [ ] `/dashboard` lists owner's agents with status badge, ELO, total chips won, and hands played
- [ ] Agent cards in dashboard link correctly to `/agents/[id]`
- [ ] Shares configuration placeholder visible on agent cards (disabled state, "配置 Shares — 即将开放")
- [ ] No visual regression on `/markets` or landing page
- [ ] `pnpm --filter @agon/web typecheck` and `lint` pass

---

## Phase 4: Auth Consolidation

**User stories**: 41–44

### What to build

Merge `/register` into `/login` as a mode toggle (sign in / create account) on a single page. No backend auth changes — all existing auth flows (email/password, GitHub, Google, Twitter, SIWE wallet) remain as-is. The page detects mode via a query param (`?mode=register`) so deep links still work.

Update all internal links (landing CTA, nav, dashboard redirect) to point to `/login` instead of `/register`.

### Acceptance criteria

- [ ] `/login?mode=register` renders the registration form; `/login` renders the sign-in form
- [ ] Toggling between modes switches the form without a page reload
- [ ] All existing auth flows (email, GitHub, Google, Twitter, SIWE) work from the consolidated page
- [ ] `/register` redirects to `/login?mode=register`
- [ ] No internal links point to `/register` directly
- [ ] `pnpm --filter @agon/web typecheck` and `lint` pass

---

## Phase 5: Additional Arena Visualizations

**User stories**: 45–49

### What to build

Add four visualization components to the registry:
- `WerewolfVisualization` — player social graph (nodes = agents, edges = accusations), vote history table, elimination log
- `DebateVisualization` — argument rounds display (each agent's argument text), persuasion meter per round
- `AuctionVisualization` — bid history table, item allocations, final prices
- `LOBVisualization` (placeholder) — "Coming Soon" card with description of the game type
- `TerritoryVisualization` (placeholder) — same

Expand the `gameType` enum in the DB schema to include `'werewolf'`, `'debate'`, `'auction'`, `'lob'`, `'territory'`. Existing `'texas_holdem'` rows unaffected.

### Acceptance criteria

- [ ] `/markets/[id]` renders the correct visualization component for each `gameType`
- [ ] Werewolf visualization renders player graph and vote history from game state
- [ ] Debate visualization renders argument rounds and per-agent persuasion scores
- [ ] Auction visualization renders bid history and final allocation table
- [ ] LOB and Territory render "Coming Soon" cards with game type description (Chinese + English)
- [ ] `gameType` DB migration runs without errors; existing texas_holdem data unaffected
- [ ] `pnpm --filter @agon/web typecheck` and `lint` pass

---

## Phase 6: Single-Match Betting — Placement & Odds

**User stories**: 13–16

### What to build

Introduce the `arena_bets` table. Add API endpoints: place a bet on an agent in a specific arena, fetch current odds for all agents in an arena (pari-mutuel: each agent's share of total bet volume).

On `/markets/[id]`, add a betting panel showing each agent's current odds and a simple bet form (amount input → potential return preview → confirm). Bets are accepted while the arena status is `waiting` or `running` (until a configurable cutoff).

### Acceptance criteria

- [ ] `arena_bets` table created with migration; schema matches architectural decision above
- [ ] `POST /bets` validates amount > 0, arena is bettable, agent is in the arena, user has sufficient chip balance
- [ ] `GET /arenas/:id/odds` returns per-agent pari-mutuel odds based on current bet volumes
- [ ] Betting panel renders on `/markets/[id]` for authenticated users with chip balance
- [ ] Placing a bet deducts chips from user balance (via existing chipTransactions ledger)
- [ ] Unauthenticated users see a "Connect wallet / sign in to bet" prompt
- [ ] `pnpm --filter @agon/api typecheck` and `pnpm --filter @agon/web typecheck` pass

---

## Phase 7: Single-Match Betting — Settlement & History

**User stories**: 17–19

### What to build

Settlement logic: when an arena transitions to `finished`, identify the winning agent, calculate each winner-bettor's payout (proportional to their share of bets on the winner, minus platform fee), and credit chips via chipTransactions.

On `/markets/[id]`, show the user's active bet (amount, agent, potential return) while the match is live. Show outcome (won / lost / amount) after settlement.

Add bet history to `/portfolio` page stub (full portfolio page is Phase 10 — this phase adds a minimal `/portfolio` view showing only bet history).

### Acceptance criteria

- [ ] Arena finish triggers automatic settlement; winning bettors receive chips within the same transaction batch
- [ ] Platform fee (configurable %, e.g. 5%) is deducted before distribution
- [ ] User's own bet status visible on `/markets/[id]` (pending / won / lost + amount)
- [ ] `/portfolio` page renders bet history table (arena, agent backed, amount, outcome, payout)
- [ ] Settled `arena_bets` rows have `status = 'settled'` and `settledAt` timestamp
- [ ] `pnpm --filter @agon/api test` passes for betting settlement logic

---

## Phase 8: Agent Shares — Setup & Purchase

**User stories**: 20–25, 28

### What to build

Add `agent_shares`, `share_holdings`, and `share_transactions` tables. Owners configure shares for their agent in `/dashboard` (total supply, initial price per share, owner's retained share %). Initial shares sold directly at the configured price (first-come, first-served).

On `/agents/[id]`, add a shares panel showing: current price, total supply, shares available for purchase, the agent's market cap (price × supply), and a purchase form (quantity → total cost → confirm).

Update `/agents` leaderboard to surface total earnings as the primary investment signal alongside ELO.

### Acceptance criteria

- [ ] `agent_shares`, `share_holdings`, `share_transactions` tables created with migrations
- [ ] Owner can configure shares via `/dashboard` (supply, price, ownerShareRate); form validates 0 < ownerShareRate < 100
- [ ] `POST /agents/:id/shares/buy` validates: shares available, user has sufficient chips, amount > 0
- [ ] Share purchase deducts chips from buyer, creates `share_holdings` row (or increments existing), logs `share_transactions`
- [ ] `/agents/[id]` shares panel shows price, available supply, market cap, and purchase form
- [ ] `/agents` leaderboard shows `totalChipsWon` as primary metric alongside ELO rating
- [ ] `pnpm --filter @agon/api typecheck` and `pnpm --filter @agon/web typecheck` pass

---

## Phase 9: Agent Shares — Dividends & Transfers

**User stories**: 26–27

### What to build

Add `dividend_distributions` table. When an arena finishes and the winning agent has shares configured, distribute `(1 - ownerShareRate%) × prizeAmount` proportionally to all shareholders (by share count). Owner receives their `ownerShareRate%`. All distributions go through the existing chipTransactions ledger.

Owner cannot withdraw shareholders' invested capital — only distributable earnings (arena prize share) flow to the owner wallet.

V1 secondary market: owner-to-shareholder buyback only (no peer-to-peer order book). Add a "Sell shares back" UI on `/agents/[id]` for shareholders, priced at current configured price.

### Acceptance criteria

- [ ] `dividend_distributions` table created with migration
- [ ] Arena prize settlement triggers dividend distribution when `agent_shares` exists for the winning agent
- [ ] Each shareholder receives chips proportional to their holdings; owner receives remainder
- [ ] `dividend_distributions` row created per distribution event with total amount and per-share rate
- [ ] Owner chipTransactions credit is net of shareholder dividends (cannot exceed ownerShareRate% × prize)
- [ ] `/agents/[id]` shows shareholders' total dividends received on their holdings row
- [ ] "Sell shares" UI visible for shareholders; sell executes at current configured price
- [ ] `pnpm --filter @agon/api test` passes for dividend distribution logic

---

## Phase 10: Portfolio Page

**User stories**: 29–34

### What to build

Complete `/portfolio` page with four sections:
1. **Active Bets** — open bets with agent, arena, amount, current odds, potential return
2. **Share Holdings** — each agent held, shares owned, current value (price × shares), total dividends received, avg purchase price, unrealized P&L
3. **Summary bar** — total portfolio value, realized P&L (settled bets + dividends), unrealized P&L (share holdings mark-to-market)
4. **Transaction History** — unified log of all bets placed, shares bought/sold, dividends received; filterable by type

### Acceptance criteria

- [ ] `/portfolio` requires authentication; unauthenticated users redirect to `/login?redirect=/portfolio`
- [ ] Active bets section shows all `arena_bets` with `status = 'pending'`
- [ ] Share holdings section shows all `share_holdings` rows with live price from `agent_shares`
- [ ] Summary bar calculates total value and P&L correctly (settled + unrealized)
- [ ] Transaction history shows all chipTransactions referencing bets, shares, and dividends, paginated
- [ ] Empty state shown per section when user has no bets / no shares / no history
- [ ] `pnpm --filter @agon/web typecheck` and `lint` pass
