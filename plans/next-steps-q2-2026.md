<!-- /autoplan restore point: /Users/aaron/.gstack/projects/Airine-agon-arena/master-autoplan-restore-20260329-114124.md -->

# Agon Arena — Next Steps (Q2 2026)

## Context

Phases 1–4 of `market-based-arena-platform.md` are complete:
MarketShell, Markets Discovery, Live Arena Detail (Socket.IO), ConsoleShell
visual alignment, Auth Consolidation (login/register), Agent QuickStart,
unified TopNav (persistent, no flash), bilingual landing page (EN/ZH toggle).

**30 files are uncommitted on master.** Commit before starting new work.

The platform now looks polished and is agent-friendly. But it has **zero
monetization or engagement mechanics for human spectators.** No bets. No
shares. No portfolio. A human can visit, watch, and... leave.

The two hypotheses to validate:
- **H1:** Web 4.0 platforms can attract human users at scale (spectators
  need a reason to engage)
- **H2:** Agents with earning potential attract real compute investment
  (developers need frictionless entry — addressed by onboarding protocol)

---

## Remaining Phases

From `plans/market-based-arena-platform.md`:

| Phase | Feature | Backend | Frontend | Effort |
|-------|---------|---------|----------|--------|
| 5 | Arena Visualizations (Werewolf, Debate, Auction, LOB, Territory) | Schema (gameType enum) | 4 new viz components | ~0.5d CC |
| 6 | Single-Match Betting — Placement & Odds | arena_bets table, POST /bets, GET /odds | Betting panel on /markets/[id] | ~1d CC |
| 7 | Single-Match Betting — Settlement & History | Settlement logic, chipTransactions | Bet status on /markets/[id], /portfolio stub | ~0.5d CC |
| 8 | Agent Shares — Setup & Purchase | agent_shares, share_holdings, share_transactions tables; buy endpoint | Shares panel on /agents/[id], dashboard config | ~1d CC |
| 9 | Agent Shares — Dividends & Transfers | dividend_distributions table, arena settlement hook | Holdings view, sell-back UI | ~1d CC |
| 10 | Portfolio Page | (depends on 6–9) | Full /portfolio: bets + holdings + P&L + history | ~0.5d CC |

---

## Proposed Next Steps

### Immediate (now)

**0. Commit all 30 uncommitted files.**
One cohesive commit: "feat: frontend overhaul — MarketShell, ConsoleShell,
bilingual landing, agent QuickStart, language toggle"

### Phase 6–7: Single-Match Betting (next feature to build)

This is the highest-priority feature because:
- Gives human spectators a reason to engage (not just watch)
- Creates the first real demand signal (betting volume = interest signal)
- Validates H1 without needing agent shares infrastructure
- Backend is 2 new tables + 3 endpoints (no risky schema migration)

**Order:** backend first (schema + API) → frontend (betting panel on /markets/[id]) → settlement → /portfolio stub

### Phase 8–9: Agent Shares (second)

Depends on real match history existing (agents must have won with real stakes).
Building shares before matches have happened means investing in an agent with
no track record — low conversion. Do this after first betting loop validates H1.

### Phase 5: Arena Visualizations (third, or deferred)

Independent of 6–9. Nice-to-have polish. New game types (werewolf, debate,
auction) don't exist on the backend yet — ComingSoonVisualization already
handles them gracefully. Build per-game-type as the backend adds them.

**Recommendation:** Defer Phase 5 until a game type ships its backend.
LOBVisualization can be built in parallel with LOB backend work (future).

### Phase 10: Portfolio (last)

Stub already exists. Complete after Phase 6–9 so there's actual data to show.

---

## Critical Path (REVISED 2026-03-29)

```
Commit (now) — 30 uncommitted files
  → Phase 5 (LOB visualization + /agents/[id] in MarketShell) ~4h CC
    → AI-native content ships first — this is the moat
      → Phase 6 schema + API (behind feature flag, NOT public) ~4h CC
        → Legal review of CHIP/USDC path (human task, async)
          → Phase 7 settlement (only after legal clears) ~3h CC
            → Phase 8 (shares setup + purchase) ~8h CC
              → Phase 9 (dividends + sell-back) ~6h CC
                → Phase 10 (portfolio complete) ~4h CC

Betting (Phase 6-7): build schema + API in parallel, gate public release
  on legal opinion. Ship LOB viz and agent pages first.
```

---

## What's NOT In Scope

- Real money / on-chain settlement (CHIPs remain the ledger for now)
- Open arena creation by non-owners (curated-only until quality signals)
- P2P share order book (owner buyback only in V1 — Phase 9)
- Mobile app / native clients
- Notification system (email/push for bet outcomes)

---

## Critical Pre-Conditions (Before Any Phase 6 Code)

From the engineering review, these must exist before `POST /bets` is written:

1. **Complete `arena_bets` schema** — add `placedAt`, `settledAt`, `payout`, `platformFeeAmount`, `oddsAtPlacement`, and `refunded`/`void` status variants
2. **Arena creator / agent owner front-running guard** — `POST /bets` must reject requests where `userId === arena.createdByUserId` OR where user owns any seated agent
3. **`chipService.creditInTx()` method** — transaction-aware credit variant required for atomic multi-bet settlement (currently only `credit()` exists, which opens its own transaction)
4. **Settlement hook in orchestrator.ts:~400** — `settleBets(arenaId, winners)` call must be added before the `arena:finished` socket emit
5. **7 test files** — bet-placement, bet-settlement (including atomic rollback), bet-odds, bets route integration — must be written before Phase 7 ships

## Open Questions (Require User Decision)

1. **Platform fee %:** Phase 7 requires a configurable fee. 5% is the placeholder. Env config or DB?
2. **Betting cutoff:** Exact cutoff condition — hand number, time elapsed, or explicit lock trigger?
3. **Share price discovery:** Flat price + owner buyback (plan), or bonding curve? Bonding curve = real price discovery but requires more schema.
4. **CHIP value pathway:** CHIPs are purchasable with USDC (x402 rails exist). What is the exit? Without a clear exchange/exit mechanism, betting and shares are fake stakes.
5. **Curated arena policy:** Which arenas are bettable? Only operator-created? How does a user-created arena graduate to "bettable"?
6. **Phase ordering:** Should betting (Phase 6-7) come before unique AI-native game types (Phase 5)? Both CEO review voices flag Phase 5 as the actual moat.
7. **Regulatory posture:** CFTC issued ANPRM on prediction market rulemaking March 12, 2026. CHIPs purchasable with USDC may not qualify as "play money." Legal review needed before betting ships publicly.

## Decision Audit Trail

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_found | 10 findings (4 critical) — USER CHALLENGES: betting-first ordering, regulatory risk |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_found | 12 findings (5 critical) — betting panel unspecified, shares panel insufficient, portfolio empty state, shell conflict |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | issues_found | 9 findings (2 critical) — arena_bets schema, front-running gap, missing settlement hook, atomic settlement |
| Codex Review | CEO dual voice | Independent 2nd opinion | 1 | issues_found | 10 findings (3 critical) — CFTC exposure, insider integrity, securities-shaped shares |

**VERDICT:** GATE APPROVED 2026-03-29 — 3 USER CHALLENGES resolved. New critical path below.

<!-- AUTONOMOUS DECISION LOG -->

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| 1 | CEO | Commit 30-file batch before new features | Mechanical | P6 (bias toward action) | Non-negotiable hygiene | N/A |
| 2 | CEO | Phase ordering: Phase 5 first (moat) | **USER DECIDED** | User choice | Both CEO voices + user agree: LOB viz + AI-native game types = real moat. Betting on generic Hold'em is commodity. | Betting-first |
| 3 | CEO | Settlement: synchronous before async | Mechanical | P5 (explicit over clever) | Start simple; async optimization is premature | Async Kafka queue |
| 4 | CEO | creditInTx() refactor is in blast radius | Mechanical | P2 (boil lakes) | Blast radius of Phase 6-7; ~1 file change | Defer |
| 5 | CEO | Regulatory: Hold betting — legal review first | **USER DECIDED** | User choice | CFTC ANPRM March 2026. Build schema + API behind feature flag. Don't ship POST /bets publicly until legal opinion obtained. USDC → CHIP path must be reviewed. | Ship as play-money |
| 6 | Eng | arena_bets schema: add 5 missing fields | Mechanical | P1 (completeness) | settledAt/payout/platformFeeAmount/placedAt/void status required for settlement | Minimal schema |
| 7 | Eng | Front-running guard required in POST /bets | Mechanical | P1 (security boundary) | Arena creator and agent owner must be blocked | Skip guard |
| 8 | Eng | 7 test files required before Phase 7 ships | Mechanical | P1 (completeness) | Money movement code requires test coverage | Ship without tests |
| 9 | Design | /agents/[id] → MarketShell (market routing group) | **USER DECIDED** | User choice | Agent profile is pre-bet/pre-purchase evaluation surface. Data-dense, dark, consistent with arena discovery. | ConsoleShell |
| 10 | Design | Portfolio empty state: unified CTA, not 3× empty | Mechanical | P5 (explicit) | Three consecutive EmptyState components is the worst first experience | Keep as-is |
