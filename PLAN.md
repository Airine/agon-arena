<!-- /autoplan restore point: /Users/aaron/.gstack/projects/Airine-agon-arena/master-autoplan-restore-20260331-135026.md -->
<!-- /autoplan restore point: /Users/aaron/.gstack/projects/Airine-agon-arena/master-autoplan-restore-20260331-102434.md -->
# Phase 10 Closeout — Activation Gate, Onboarding Unification, Tier Cleanup

**Date:** 2026-04-03  
**Branch:** master  
**Status:** IN PROGRESS — engineering tracks largely shipped; remaining work is activation proof and public-surface cleanup.

---

## Context

The 2026-03-31 Phase 10 plan was directionally right for that moment, but the repo moved fast.

What is now already shipped in code:
- LOB engine tests and integration coverage
- Deterministic LOB seeds
- Turn replay APIs and error traces
- Agent History tab in the arena detail page
- Global rate limiting, leaderboard total fix, and `X-API-Version`
- Hosted practice entrypoints: `QUICKSTART.md`, `agon-agent protocol run`, `/arenas/sandbox/create`
- Funnel event writes for `wallet_connected`, `session_created`, `arena_joined`, `first_turn_received`, and `first_action_submitted`

What is still missing:
1. A read-side for the funnel data, so demand validation can be measured instead of guessed
2. One canonical public onboarding path, because landing, login, docs, and helper copy still disagree
3. Clean tier semantics, because `micro` is still implied publicly but is not a first-class product path
4. A hard publish gate artifact for Phase 11

The bottleneck is no longer missing surface area. It is missing truth.

---

## What Changed Since The Old Plan

### Shipped

- **Track 1 is done enough**: LOB tests, GBM determinism, and `lob_order_log` writes exist
- **Track 2 is done enough**: turn replay, deterministic seeds, error traces, and the history UI exist
- **Track 3 is mostly done**: global rate limiting, API version header, and leaderboard total count are live

### Still incomplete

- **Demand acquisition is not actually done**: there is no durable named alpha roster, no funnel read model, and no weekly gate report
- **Onboarding is fragmented**: some public surfaces teach `protocol run`, others still teach the old wallet/bootstrap/list/join SOP
- **Tier messaging is misleading**: public copy implies a usable `micro` tier before the backend/CLI semantics truly support it

### Historical note

The previous Phase 10 plan is now historical context, not an execution document. Git history preserves the old details if we need them.

---

## Current Bottleneck

The real question is now:

Can an external developer, cold, install the CLI, run the modern protocol path, submit at least one real action, and do it without DM support?

Today the repo cannot answer that with evidence.

It can emit funnel events, but it cannot summarize them.
It can create sandbox arenas, but it cannot prove outsiders are using them.
It can show a polished history UI, but it still sends some users to stale onboarding instructions.

That is the whole game.

---

## Priority Order

0. **Activation Truth** — named alpha roster + funnel read model + weekly gate artifact  
1. **Public Onboarding Unification** — every public surface teaches the same protocol-run path  
2. **Tier Semantics Cleanup** — stop promising `micro` until it is real  
3. **Phase 11 Gate** — npm/PyPI/docs publish only after the activation gate is met

---

## Track 0: Activation Truth

### Goal

Make demand validation measurable.

### Scope

**0a. Named alpha roster, outside git**

- Maintain a private roster of 3-5 named external developers outside the repository
- Track for each person:
  - outreach sent
  - install attempted
  - smoke test passed
  - `protocol run` reached `competing`
  - first action submitted
  - first arena completed
- If this roster does not exist, demand validation is not done

**0b. Funnel read model**

Build the smallest possible read-side for `agon.agent.funnel`.

Acceptable forms:
- a protected admin API + simple internal page, or
- a repo script that materializes a daily JSON/CSV report from Kafka

Minimum outputs:
- unique agents by funnel stage
- stage-to-stage conversion
- most recent successful external agents
- arenas that reached `first_turn_received` but not `first_action_submitted`

Do not build a full analytics product. Just enough to stop guessing.

**0c. Weekly gate artifact**

Produce a weekly artifact with:
- named alpha count
- unique external agent count
- first-action count
- completed-arena count
- accumulated external runtime hours, or the best proxy available if hours are not yet logged directly

Store it outside git or under a working directory such as `.omx/` or `~/.gstack/`.

### What already exists

- Funnel topic and write-side events:
  - `apps/api/src/services/kafka.ts`
  - `apps/api/src/routes/auth.ts`
  - `apps/api/src/routes/arenas.ts`
  - `apps/api/src/services/orchestrator.ts`
- Sandbox creation path: `apps/api/src/routes/arenas.ts`
- Public CLI entrypoint: `sdks/agent-skill/commands/protocol.js`
- Public quickstart: `QUICKSTART.md`

### Not in scope

- Full BI stack
- Public analytics dashboard
- Marketing automation

### Success criteria

- One command or one page answers funnel dropoff without log spelunking
- At least 3 named external developers exist in the private alpha roster
- At least 1 external agent reaches `first_action_submitted`
- The Phase 11 publish decision can be made from artifacts, not anecdotes

---

## Track 1: Public Onboarding Unification

### Goal

Make every public surface teach the same fast path.

### Canonical path

```bash
agon-agent protocol run \
  --wallet-policy=create-if-missing \
  --create-if-none \
  --decision-cmd "<your decision script>"
```

Validation command:

```bash
agon-agent smoke full --wallet-policy=create-if-missing --api-base https://agon.win/api
```

### Scope

- Make `protocol run` the only public fast path on landing, login quickstart, docs, and helper copy
- Remove public instructions that still teach:
  - `agon-agent wallet create`
  - `agon-agent access bootstrap`
  - `agon-agent arena list && agon-agent arena join`
  as the recommended onboarding flow
- Prefer using `apps/web/src/lib/agent-onboarding.ts` as the canonical text source where practical
- Keep `protocol resume` documented as the crash recovery path

### What already exists

- Landing already shows `protocol run`
- `apps/web/src/lib/agent-onboarding.ts` already encodes the modern protocol
- `QUICKSTART.md` already centers the protocol-run flow

### Success criteria

- Landing, login, docs, and quickstart all show the same command family
- No public doc asks the user to manually step through the old wallet/bootstrap/list/join SOP
- `smoke full` is documented as the validation path

---

## Track 2: Tier Semantics Cleanup

### Goal

Stop promising `micro` until it is a real product tier.

### Decision

For this phase, choose the boring answer:

**Remove `micro` from public guidance.**

Keep any internal alias only if it is needed for backward compatibility, but do not market it.

### Why

Today:
- CLI help still exposes `micro`
- CLI behavior maps `micro` to `practice`
- public quickstart copy implies `micro` is a live real-stakes path

That is not a feature. That is misleading copy.

### Scope

- Remove `micro` from public quickstarts and UI copy
- Describe serious arenas as curated, not self-serve
- Keep the true backend cleanup or first-class tier implementation for a later phase

### Success criteria

- No public-facing doc or UI suggests `--arena-tier micro` unlocks a separate live tier
- Practice is the default self-serve path
- Serious remains curated until implemented properly

---

## Track 3: Phase 11 Publish Gate

SDK/npm/PyPI/docs publish stays blocked until all of these are true:

1. Activation read model exists
2. Named alpha roster exists
3. At least 1 external agent reached `first_action_submitted`
4. Public onboarding surfaces are unified
5. Tier semantics are no longer misleading

If any item is false, Phase 11 publish work does not start.

---

## Immediate Repo Cleanup

These are the low-risk repo fixes worth doing right now:

1. Update public onboarding docs and UI copy to the protocol-run flow
2. Exempt `/health` from global rate limiting by registering it before the global middleware
3. Replace the stale Phase 10 plan with this closeout plan

---

## Execution Order

```text
1. Update public onboarding surfaces to one canonical protocol-run path
2. Move /health above the global rate limiter
3. Build the minimum funnel read model
4. Produce the first weekly gate artifact
5. Review named alpha progress against the gate
6. Only then decide whether Phase 11 publish work starts
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Demand work remains anecdotal because no read-side is built | High | High | Build the minimal funnel report before any new publish work |
| Public onboarding stays fragmented and poisons activation data | High | High | Unify landing, login, docs, and quickstart now |
| Users try `--arena-tier micro` and assume a false real-money path | Medium | High | Remove `micro` from public guidance until first-class support exists |
| SDK publish resumes before the gate is real | Medium | High | Require the weekly gate artifact before any publish decision |
| Private alpha roster leaks into git history | Low | Medium | Keep names outside git; only track aggregate counts in repo-adjacent artifacts |

---

## Success Metrics

- Zero contradictory public onboarding flows
- Zero public references to `micro` as a real self-serve tier
- One repeatable funnel report exists
- One weekly gate artifact exists
- At least 1 external agent reaches `first_action_submitted`

---

## Deferred

- npm public publish
- PyPI publish
- `/docs/api` polish
- compare-two-arenas replay view
- Portfolio V2
- first-class `micro` tier implementation
- full analytics dashboard
