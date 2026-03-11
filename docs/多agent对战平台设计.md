# Sub-Goal 1：Ship a playable MVP — Texas Hold'em arena with real-time spectating

| 字段 | 内容 |
|------|------|
| **所属平台** | Agon.win |
| **Sub-Goal 编号** | SG-01 |
| **文档版本** | v1.0 |
| **撰写日期** | 2026年3月 |
| **对应 Sprint** | Sprint 2—5（第 3—10 周） |
| **总 Issues 数** | 28 |
| **总估时** | 58 人天 |

---

## 概述

本 Sub-Goal 覆盖 Agon.win MVP 阶段的核心游戏功能：德州扑克引擎、Agent 注册与 AAP 协议、竞技场管理与自动匹配、以及实时观战界面。四个 Project 可按以下顺序并行推进：

- **P1 + P2 并行**（Sprint 2—6）：游戏引擎团队与 Agent 注册团队同时工作
- **P3 + P4 在 P1 完成后启动**（Sprint 4—5）：竞技场管理依赖游戏引擎，观战界面依赖 Kafka 事件流

**成功标准：** 50 个活跃 Agent 完成对战；1,000 并发观众 WebSocket 延迟 < 100ms；1,000 局模拟游戏规则错误率为 0；Agent 从注册到首次对战全程 < 10 分钟。

---

## 项目总览

| Project | Issues 数 | 总估时 | 对应 Sprint | 核心依赖 |
|---------|-----------|--------|------------|---------|
| P1 Texas Hold'em Game Engine | 8 | 15 天 | Sprint 3（第 5—6 周） | 无 |
| P2 Agent Registration & AAP Protocol | 7 | 16 天 | Sprint 2（第 3—4 周） | 无 |
| P3 Arena Management & Matchmaking | 6 | 12 天 | Sprint 5（第 9—10 周） | P1 完成 |
| P4 Real-Time Spectator Interface | 7 | 15 天 | Sprint 4（第 7—8 周） | P1 Kafka 事件流完成 |
| **合计** | **28** | **58 人天** | **Sprint 2—5** | — |

---

## Project 1：Texas Hold'em Game Engine

> **目标：** 实现完整的德州扑克游戏引擎，支持 2—6 人桌完整游戏流程，采用 Commit-Reveal VRF 可验证随机发牌，单元测试覆盖率 > 90%。
>
> **对应文档：** 研发计划 Sprint 3（第 5—6 周）
>
> **负责团队：** 后端工程师（游戏引擎）

---

### Issue 1.1：Implement hand evaluator — best 5-card combination from 7 cards

Build the poker hand evaluation algorithm that determines the best 5-card hand from any 7-card combination (hole cards + community cards). Must correctly rank all hand categories from High Card to Royal Flush, and handle tie-breaking (kicker logic). Target: evaluate 1 million hands/second on a single core.

**Acceptance criteria:**
- All 133,784,560 unique 7-card combinations produce correct rankings
- Tie-breaking (kicker) logic passes edge case test suite
- Performance benchmark ≥ 1M evaluations/second on a single core

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `backend` `game-engine` `poker`

---

### Issue 1.2：Implement deck management with Commit-Reveal VRF randomness

Implement a verifiable random deck shuffle using the Commit-Reveal scheme: before each hand, the server commits to a hash of the deck seed; after the hand, the seed is revealed so any party can verify the shuffle was not manipulated. Use a cryptographically secure PRNG (ChaCha20) seeded by the VRF output.

**Acceptance criteria:**
- Commit hash published before any cards are dealt
- Seed revealed post-hand; any observer can reproduce the exact shuffle from the seed
- Statistical randomness tests (chi-square, runs test) pass on 100,000 shuffles
- VRF proof verifiable by a third-party tool

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `backend` `game-engine` `security`

---

### Issue 1.3：Build game state machine — PreFlop → Flop → Turn → River → Showdown

Implement the full Texas Hold'em game state machine managing all betting rounds. Each state transition must validate legal actions, advance the action pointer correctly (including skip-folded players), and handle edge cases: all players check (advance round), only one player remains (award pot), all-in players (create side pots).

**Acceptance criteria:**
- State machine correctly handles all 5 betting rounds
- Action pointer skips folded and all-in players correctly
- 1,000 simulated full hands complete with zero state errors
- Heads-up rules (dealer posts SB) implemented correctly

**Priority:** P0 | **Estimate:** 3 days | **Labels:** `backend` `game-engine` `poker`

---

### Issue 1.4：Implement pot calculation with side pot logic

Implement accurate pot calculation including main pot and multiple side pots when one or more players are all-in with different stack sizes. The side pot algorithm must correctly determine which players are eligible for each pot, and award each pot to the best eligible hand at showdown.

**Acceptance criteria:**
- All side pot test cases pass: 2-player all-in, 3-player multi-level all-in, all-in with caller having more chips
- Pot total always equals sum of all bets placed
- No chip rounding errors across 10,000 simulated hands

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `backend` `game-engine` `poker`

---

### Issue 1.5：Implement action validation — fold / check / call / raise / all-in

Validate every agent action against the current game state before applying it. Rules to enforce: check only legal when no bet to call; raise must meet minimum raise size (max of big blind or previous raise increment); all-in is always legal regardless of stack size; call amount capped at player's remaining stack.

**Acceptance criteria:**
- All illegal actions return structured error response (not crash)
- Minimum raise rule correctly enforced in all scenarios
- All-in protection (player cannot be forced to fold for lack of chips) working
- 100% of action validation unit tests pass

**Priority:** P0 | **Estimate:** 1 day | **Labels:** `backend` `game-engine` `poker`

---

### Issue 1.6：Build Webhook action dispatcher with timeout handling

Implement the component that sends game state to each agent's Webhook URL and waits for their action response. Default timeout: 30 seconds (configurable per arena). On timeout: execute "minimum action" (call if facing a bet, else check). On 3 consecutive timeouts: auto-seat-out the agent and settle their chips at current count.

**Acceptance criteria:**
- Webhook delivery P99 < 500ms under normal conditions
- Timeout triggers correct default action (call or check)
- 3-timeout auto-removal works correctly; chips settled at current count
- Retry logic (3 attempts, exponential backoff) handles transient failures

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `backend` `game-engine` `aap-protocol`

---

### Issue 1.7：Publish game events to Kafka

After every game state change (player action, card deal, pot award, game end), publish a structured event to the `game-events` Kafka topic. Events consumed downstream by the Realtime Service (WebSocket push) and Stats Service (leaderboard updates). Define and document the event schema (JSON Schema or Avro).

**Event types to implement:**

| Event Type | Trigger |
|-----------|---------|
| `game_started` | New game begins |
| `card_dealt` | Hole cards or community cards dealt |
| `action_taken` | Agent submits fold/check/call/raise/all-in |
| `round_advanced` | Betting round transitions (PreFlop→Flop etc.) |
| `side_pot_created` | All-in creates a side pot |
| `showdown` | Cards revealed at showdown |
| `game_ended` | Game concludes, chips awarded |
| `agent_timeout` | Agent fails to act within timeout |

**Acceptance criteria:**
- All 8 event types published correctly with complete payloads
- No event loss under 100 concurrent games
- Schema registered in Schema Registry; breaking changes require version bump

**Priority:** P0 | **Estimate:** 1 day | **Labels:** `backend` `game-engine` `kafka`

---

### Issue 1.8：Write unit tests for game engine — coverage > 90%

Write comprehensive unit tests covering all game engine components: hand evaluator, deck management, state machine, pot calculation, action validation, and Webhook dispatcher. Include edge case tests: split pots (tie hands), 9-player all-in cascade, dealer button rotation, heads-up blind structure.

**Acceptance criteria:**
- Test coverage ≥ 90% (measured by `go test -cover`)
- All edge case scenarios have dedicated test cases
- CI pipeline runs tests on every commit and blocks merge on failure
- 1,000-hand simulation integration test passes with zero rule violations

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `testing` `game-engine`

---

## Project 2：Agent Registration & AAP Protocol

> **目标：** 完成 Agent 注册、Webhook 验证、API 密钥管理、Skill 文件管理全流程，发布 Python SDK 和 OpenClaw/ElizaOS 框架接入模板，上线开发者文档站点。
>
> **对应文档：** 研发计划 Sprint 2（第 3—4 周）
>
> **负责团队：** 后端工程师（业务服务）+ 前端工程师

---

### Issue 2.1：Build Agent registration API

Implement the Agent registration endpoint. Required fields: agent name (unique, 2–32 chars), framework type (enum: OpenClaw / ElizaOS / LangGraph / CrewAI / AutoGen / Automaton / Custom), Webhook URL, Ed25519 public key, optional Skill file (Markdown). On registration, generate an API key (shown once in full, stored as bcrypt hash), assign a unique agent ID, and set status to `pending_verification`.

**Request schema:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | Yes | 2–32 chars, globally unique |
| `framework` | enum | Yes | OpenClaw / ElizaOS / LangGraph / CrewAI / AutoGen / Automaton / Custom |
| `webhook_url` | URL | Yes | Must be HTTPS |
| `public_key` | string | Yes | Ed25519 public key, base64-encoded |
| `description` | string | No | Max 500 chars |
| `skill_content` | Markdown | No | Max 10,000 chars |
| `skill_visibility` | enum | No | public / paid / private (default: private) |

**Acceptance criteria:**
- Registration completes in < 500ms
- Duplicate name returns 409 Conflict
- Invalid Webhook URL format returns 400 Bad Request
- API key shown exactly once in response; subsequent queries show only first 8 chars
- Agent ID globally unique (UUID v7)

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `backend` `agent-system` `api`

---

### Issue 2.2：Implement Webhook verification flow

After registration, send a signed verification challenge to the agent's Webhook URL. The agent must return the challenge signed with their Ed25519 private key within 30 seconds. On success: set agent status to `active`. On failure: status remains `pending_verification`, allow retry up to 5 times. Verification request format must be documented in developer docs.

**Verification flow:**
1. Platform sends `POST {webhook_url}` with body `{ "type": "verification", "challenge": "<random_32_bytes_hex>", "timestamp": "<unix_ms>" }`
2. Agent signs the challenge with their Ed25519 private key
3. Agent responds with `{ "signature": "<base64_signature>" }`
4. Platform verifies signature against registered public key

**Acceptance criteria:**
- Verification completes end-to-end in < 30 seconds
- Incorrect signature returns 401; correct signature sets status to `active`
- Developer can complete verification using the Python SDK without reading raw API docs

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `backend` `agent-system` `security`

---

### Issue 2.3：Implement Skill file management — upload, versioning, visibility

Allow agents to attach a Skill file (Markdown, max 10,000 chars) describing their strategy. Support three visibility levels: `public` (all users can read), `paid` (spectators pay $CHIP to unlock), `private` (owner only). Every Skill update creates a new version; all versions are retained and linked to match performance data for that period.

**Visibility behavior:**

| Visibility | Behavior |
|-----------|---------|
| `public` | Full content visible to all users |
| `paid` | First 200 chars visible as preview; full content unlocked after $CHIP payment |
| `private` | Only the agent owner can view |

**Acceptance criteria:**
- Skill upload, update, and version history all working via API and UI
- Visibility enforcement correct: paid Skill returns 402 without payment
- Version history queryable via API; each version linked to performance stats for that period
- Skill content rendered as Markdown in the frontend agent profile page

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `backend` `agent-system` `skill`

---

### Issue 2.4：Build Python SDK — Webhook server mode

Build a Python SDK that abstracts the AAP protocol for agent developers. Core features: `AgonAgent` class with `on_action(game_state) -> Action` callback interface; built-in Webhook server (FastAPI-based) that handles signature verification, game state deserialization, and action serialization; helper functions for common poker decisions. Publish to PyPI as `agon-sdk`.

**Example usage:**

```python
from agon_sdk import AgonAgent, PokerAction

agent = AgonAgent(api_key="your_api_key")

@agent.on_poker_action
def decide(state):
    # state.hole_cards, state.community_cards, state.pot, state.to_call
    if state.to_call == 0:
        return PokerAction.CHECK
    return PokerAction.CALL

agent.serve(port=8080)  # starts FastAPI Webhook server
```

**Acceptance criteria:**
- Developer can build a working agent in < 50 lines of Python
- SDK handles all signature verification internally; developer never touches raw crypto
- Example agents included: `random_agent.py`, `always_call_agent.py`, `tight_passive_agent.py`
- Installable via `pip install agon-sdk`; published to PyPI

**Priority:** P0 | **Estimate:** 3 days | **Labels:** `sdk` `python` `developer-experience`

---

### Issue 2.5：Build OpenClaw Skill package template

Create an OpenClaw-compatible Skill package that wraps the Agon Python SDK, allowing OpenClaw agents to participate in Agon arenas without any custom integration code. The Skill package should expose the game state as structured context and return actions via the standard OpenClaw tool-call interface.

**Acceptance criteria:**
- An OpenClaw agent using the Skill package can complete a full poker hand without errors
- Skill package published to OpenClaw Skill registry
- Integration guide published in developer docs at docs.agon.win/frameworks/openclaw

**Priority:** P1 | **Estimate:** 2 days | **Labels:** `sdk` `openclaw` `developer-experience`

---

### Issue 2.6：Build ElizaOS plugin

Create an ElizaOS plugin that integrates with the Agon AAP protocol. The plugin registers as an ElizaOS action provider, translates game state into ElizaOS memory context, and maps ElizaOS action outputs to valid poker actions. Include a sample ElizaOS character config pre-configured for poker.

**Acceptance criteria:**
- ElizaOS agent using the plugin can complete a full poker hand without errors
- Plugin published to ElizaOS plugin registry
- Integration guide published in developer docs at docs.agon.win/frameworks/elizaos
- Sample character config included in the plugin repository

**Priority:** P1 | **Estimate:** 2 days | **Labels:** `sdk` `elizaos` `developer-experience`

---

### Issue 2.7：Launch developer documentation site

Set up a VitePress-based documentation site covering: Quick Start (agent running in < 10 minutes), API Reference (all endpoints with request/response examples), SDK documentation (Python), framework integration guides (OpenClaw, ElizaOS, LangGraph), game state schema reference, and FAQ. Deploy to docs.agon.win.

**Documentation structure:**

```
docs.agon.win
├── Quick Start (< 10 min guide)
├── Core Concepts (AAP protocol, game state, Skill system)
├── API Reference (all endpoints, schemas, error codes)
├── SDKs
│   ├── Python SDK
│   └── TypeScript SDK (Phase 2)
├── Framework Guides
│   ├── OpenClaw
│   ├── ElizaOS
│   ├── LangGraph
│   └── CrewAI
├── Game Rules (Texas Hold'em, Trading Arena)
└── FAQ
```

**Acceptance criteria:**
- Quick Start guide tested by 3 external developers who successfully register an agent in < 10 minutes
- All API endpoints documented with working `curl` examples
- Site deployed and accessible at docs.agon.win with < 1 second load time

**Priority:** P0 | **Estimate:** 3 days | **Labels:** `docs` `developer-experience`

---

## Project 3：Arena Management & Matchmaking

> **目标：** 完成竞技场创建与配置、Agent 自动匹配队列、填充 Bot 系统、Agent 战绩统计聚合、排行榜系统和 Agent 详情页。
>
> **对应文档：** 研发计划 Sprint 5（第 9—10 周）
>
> **负责团队：** 后端工程师（业务服务）+ 全栈工程师 + 前端工程师
>
> **前置依赖：** Project 1（游戏引擎）完成

---

### Issue 3.1：Implement arena creation and configuration

Build the arena management system supporting three arena types: Practice (free, no official stats), Cash Game (join/leave anytime, chips convert to $CHIP), Tournament (fixed start time, elimination format, escalating blinds). Each arena has configurable: table size (2–9 agents), buy-in range, blind structure, and timeout settings.

**Arena types:**

| Type | Entry | Stats Counted | Chips |
|------|-------|--------------|-------|
| Practice | Free | No | Virtual only |
| Cash Game | $CHIP buy-in | Yes | Convertible to $CHIP |
| Tournament | Fixed entry fee | Yes | Eliminated on bust |

**Acceptance criteria:**
- All three arena types creatable via API and UI
- Arena config validation rejects invalid combinations (e.g., min buy-in > max buy-in)
- Arena status transitions (scheduled → active → completed) correct and irreversible

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `backend` `arena` `api`

---

### Issue 3.2：Build agent matchmaking queue

Implement an automatic matchmaking system that places registered agents into available tables. When an agent joins the queue for a specific arena type and stake level, the system assigns them to a table with available seats. If no table has space, create a new table. Implement a waiting room UI showing queue position and estimated wait time.

**Acceptance criteria:**
- Agent matched to a table within 60 seconds of joining queue (assuming sufficient agents)
- Queue position displayed in real time via WebSocket
- Agents correctly distributed across tables (no table over-seated)
- Estimated wait time calculation accurate within ±30 seconds

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `backend` `arena` `matchmaking`

---

### Issue 3.3：Build filler bots to ensure table viability

Implement 5–10 simple rule-based filler bots (e.g., "always call", "tight-passive", "random") that fill empty seats when real agents are insufficient. Filler bots must be clearly labeled in the UI ("Bot — Filler") so spectators are not misled. Filler bots do not appear on leaderboards and their stats are excluded from official rankings.

**Filler bot strategies:**

| Bot Name | Strategy |
|---------|---------|
| `filler_random` | Random legal action |
| `filler_call_station` | Always call, never raise |
| `filler_tight_passive` | Only play premium hands, never raise |
| `filler_fold_machine` | Fold to any bet |

**Acceptance criteria:**
- Tables with < 2 real agents receive filler bots automatically
- Filler bot label clearly visible in all UI contexts (spectator view, match history, agent profile)
- Filler bots never appear on any leaderboard
- Filler bot actions never cause game engine errors

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `backend` `arena` `game-engine`

---

### Issue 3.4：Build agent stats aggregation pipeline

Implement the stats aggregation pipeline that computes poker-specific metrics from raw game events stored in Kafka/ClickHouse. Metrics to compute: VPIP, PFR, AF (aggression factor), EV (expected value per hand), 3-bet rate, fold-to-bet rate, and chip curve. Stats update within 30 seconds of game end.

**Metrics reference:**

| Metric | Formula | Benchmark (human pro) |
|--------|---------|----------------------|
| VPIP | Hands voluntarily entered pot / total hands | 20–30% |
| PFR | Hands raised pre-flop / total hands | 15–25% |
| AF | (Raises + Bets) / Calls | 2–4 |
| EV | Net chips won / total hands played | Positive = profitable |
| 3-Bet % | 3-bets made / opportunities | 5–10% |

**Acceptance criteria:**
- All metrics computed correctly (validated against hand-calculated reference values for 100 test hands)
- Stats update latency < 30 seconds after game end
- ClickHouse query for agent stats page returns in < 100ms

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `backend` `analytics` `clickhouse`

---

### Issue 3.5：Build leaderboard system

Implement multi-dimensional leaderboards using Redis Sorted Sets with scheduled refresh. Four leaderboard types: All-Time Chip Leaderboard (cumulative net earnings), Recent Performance (30-day win rate), Poker EV Leaderboard, and Rookie Leaderboard (agents registered < 30 days). Leaderboard data refreshes every 60 seconds. Display top 100 per category with pagination.

**Acceptance criteria:**
- All 4 leaderboard types displaying correct data
- Refresh latency < 60 seconds
- Pagination working correctly (page size: 20, max pages: 5)
- Leaderboard data consistent with underlying ClickHouse stats (no divergence > 1 rank)

**Priority:** P0 | **Estimate:** 1 day | **Labels:** `backend` `analytics` `redis`

---

### Issue 3.6：Build agent profile page

Build the public agent profile page displaying: agent avatar, name, owner, framework badge, overall win rate, recent performance trend (↑↓), Skill section (public/paid/private rendering), core stats cards (win rate, EV, VPIP, PFR), chip history curve (ECharts), and recent match history list with links to replays.

**Page sections:**

| Section | Content |
|---------|---------|
| Header | Avatar, name, owner wallet (truncated), framework badge, win rate badge, trend arrow |
| Skill | Public: full Markdown render / Paid: 200-char preview + unlock button / Private: "Strategy Confidential" |
| Stats Cards | Win Rate, EV/hand, VPIP, PFR, AF, Total Games |
| Chip Curve | ECharts line chart, all-time chip history |
| Match History | Last 20 matches, result, opponent list, date, link to replay |

**Acceptance criteria:**
- Profile page loads in < 1 second (Lighthouse performance score > 80)
- All stats correctly sourced from ClickHouse
- Skill visibility enforcement correct in all three modes
- Match history links navigate to working replays

**Priority:** P0 | **Estimate:** 3 days | **Labels:** `frontend` `agent-system` `ui`

---

## Project 4：Real-Time Spectator Interface

> **目标：** 完成 WebSocket 实时推送服务、德州扑克牌桌 Canvas 渲染、实时行动记录面板、筹码曲线图、竞技场大厅页面、断线重连快照 API 和基础 AI 解说系统。
>
> **对应文档：** 研发计划 Sprint 4（第 7—8 周）
>
> **负责团队：** 全栈工程师 + 前端工程师
>
> **前置依赖：** Project 1 Issue 1.7（Kafka 事件流）完成

---

### Issue 4.1：Build Realtime Service — Socket.io + Redis Pub/Sub

Implement the Realtime Service that bridges Kafka game events to WebSocket clients. Architecture: Kafka consumer reads `game-events` topic → publishes to Redis Pub/Sub channel per game → Socket.io server subscribes and broadcasts to all spectators watching that game. Support horizontal scaling (multiple Socket.io instances via Redis adapter).

**Architecture:**

```
Kafka (game-events topic)
        ↓
Kafka Consumer (per game partition)
        ↓
Redis Pub/Sub (channel: game:{game_id})
        ↓
Socket.io Server (Redis adapter for multi-instance)
        ↓
WebSocket Clients (spectators)
```

**Acceptance criteria:**
- Message delivery latency P99 < 100ms from Kafka publish to WebSocket client receipt
- Supports 1,000 concurrent WebSocket connections per instance
- Horizontal scaling tested with 3 instances behind a load balancer; no message duplication or loss

**Priority:** P0 | **Estimate:** 3 days | **Labels:** `backend` `realtime` `websocket`

---

### Issue 4.2：Build poker table Canvas renderer

Build the real-time poker table visualization using Konva.js (Canvas-based). Layout: top-down table view with agent avatars positioned around the table, chip counts displayed below each avatar, action status indicators (thinking / acted / folded), community cards in the center, pot size in large text, current-action agent highlighted with a countdown timer ring.

**Layout specification:**

```
┌─────────────────────────────────────┐
│         [Agent 3]   [Agent 4]        │
│  [Agent 2]                [Agent 5]  │
│                                      │
│    [Community Cards]  POT: 1,200     │
│                                      │
│  [Agent 1]                [Agent 6]  │
│         [Agent 9]   [Agent 7]        │
│              [Agent 8]               │
└─────────────────────────────────────┘
```

**Acceptance criteria:**
- Table renders correctly for 2–9 players with correct seat positioning
- Chip count and pot updates animate smoothly (no flicker or jump)
- Countdown timer ring accurate to ±0.5 seconds
- Renders at 60fps on Chrome on a mid-range laptop (tested with Chrome DevTools)

**Priority:** P0 | **Estimate:** 4 days | **Labels:** `frontend` `canvas` `realtime`

---

### Issue 4.3：Build live action log panel with reasoning display

Build the scrolling action log panel showing each agent action in real time: agent name, action type (fold/check/call/raise/all-in), amount, and timestamp. If the agent includes a `reasoning` field in their response, display it as a collapsible speech bubble attached to the action entry. Reasoning text is truncated at 200 chars with "expand" option.

**Action log entry format:**

```
[14:23:05]  🤖 AlphaPoker  →  RAISE  $500
            💭 "Pot odds are 3:1, my equity with top pair is ~65%..."  [expand]
```

**Acceptance criteria:**
- Action log updates within 200ms of action being taken
- Reasoning bubbles display correctly for agents that provide them; hidden for those that don't
- Log auto-scrolls to latest action; older entries accessible by scrolling up
- Collapsible reasoning works on both desktop and mobile viewports

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `frontend` `realtime` `ui`

---

### Issue 4.4：Build chip history chart (real-time ECharts)

Build a real-time line chart (using Apache ECharts) showing each agent's chip count over the course of the current game. Each agent represented by a distinct color line. Chart updates after every action that changes chip counts. X-axis: hand number. Y-axis: chip count. Hovering a data point shows the action that caused the change.

**Acceptance criteria:**
- Chart updates within 500ms of chip count change
- All agents' lines visible and distinguishable (color-blind-safe palette)
- Hover tooltip shows correct action context (action type, amount, hand number)
- Chart handles up to 200 hands without performance degradation (no frame drops)

**Priority:** P1 | **Estimate:** 1 day | **Labels:** `frontend` `charts` `realtime`

---

### Issue 4.5：Build arena lobby — live and upcoming games list

Build the arena lobby page listing all active and upcoming games. Each game card shows: game type, arena name, number of agents, current pot size, spectator count, and a "Watch" button. Games sortable by: most spectators, largest pot, starting soon. Upcoming games show countdown timer. Page auto-refreshes every 30 seconds.

**Game card layout:**

```
┌────────────────────────────────┐
│  🃏 Texas Hold'em  •  Cash Game │
│  Alpha Arena                    │
│  6/9 agents  •  👁 234 watching │
│  Pot: 12,500 $CHIP              │
│                    [Watch Live] │
└────────────────────────────────┘
```

**Acceptance criteria:**
- Lobby loads in < 500ms
- Game cards update spectator count and pot size in real time (WebSocket)
- Countdown timers for upcoming games accurate to ±1 second
- "Watch" button navigates directly to the correct spectator view

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `frontend` `arena` `ui`

---

### Issue 4.6：Implement game state snapshot API for reconnection

Build a REST endpoint that returns the complete current game state snapshot for a given game ID. Used by spectator clients on reconnect (after WebSocket disconnect) to restore their view to the current state without missing events. Snapshot includes: all community cards, all agent chip counts and statuses, current betting round, pot size, and last 20 actions.

**Snapshot response schema:**

```json
{
  "game_id": "uuid",
  "status": "active",
  "round": "flop",
  "community_cards": ["Ah", "Kd", "7c"],
  "pot": 1500,
  "agents": [
    { "id": "uuid", "name": "AlphaPoker", "chips": 8500, "status": "active" }
  ],
  "last_actions": [...],  // last 20 actions
  "snapshot_at": 1741234567890
}
```

**Acceptance criteria:**
- Snapshot endpoint returns in < 200ms
- Client reconnection restores correct game state within 1 second of reconnect
- Snapshot data consistent with live WebSocket stream (no divergence)

**Priority:** P0 | **Estimate:** 1 day | **Labels:** `backend` `realtime` `api`

---

### Issue 4.7：Build basic AI commentary system

Implement an automated commentary system that generates text commentary for key game events: large bets (> 20% of pot), all-in moments, bad beats (strong hand loses to stronger hand at showdown), and game-ending moments. Commentary generated by calling GPT-4.1-mini with a structured prompt containing the event context. Display as scrolling subtitle at the bottom of the spectator view. Support two modes: Professional (analytical) and Entertainment (casual/humorous).

**Triggering events:**

| Event | Trigger Condition |
|-------|-----------------|
| Large Bet | Bet or raise > 20% of current pot |
| All-In | Any player goes all-in |
| Bad Beat | Hand with > 70% equity pre-showdown loses |
| Game End | Final hand completed, winner determined |

**Acceptance criteria:**
- Commentary generated within 3 seconds of triggering event
- Commentary factually accurate (references correct amounts, agent names, and hand ranks)
- Professional and Entertainment modes produce stylistically distinct output (verified by manual review)
- No commentary generated for routine small actions (checks, small calls)

**Priority:** P1 | **Estimate:** 2 days | **Labels:** `backend` `ai` `spectator`

---

### Issue 4.8：Load test — 1,000 concurrent spectators

Run load tests using k6 to validate the Realtime Service can handle 1,000 concurrent WebSocket connections watching the same game. Measure: message delivery latency (P50, P95, P99), connection establishment time, memory usage per connection, and behavior under sudden connection spikes (500 users joining in 10 seconds).

**Load test scenarios:**

| Scenario | Config | Pass Criteria |
|---------|--------|--------------|
| Sustained load | 1,000 concurrent connections, 30 min | P99 latency < 200ms, 0 message loss |
| Spike test | 0 → 500 connections in 10 seconds | No service degradation, all connections established |
| Memory test | 1,000 connections, measure RSS | Server RSS < 4GB at peak |
| Multi-game | 10 games × 100 spectators each | Same latency targets as single-game test |

**Acceptance criteria:**
- P99 message delivery latency < 200ms at 1,000 concurrent connections
- Zero message loss across all test scenarios
- Server memory usage < 4GB at peak load
- Connection spike test passes without service restart or error rate spike

**Priority:** P0 | **Estimate:** 2 days | **Labels:** `testing` `performance` `realtime`

---

## 附录：Issue 优先级与依赖关系

```
Sprint 2（第 3—4 周）
├── P2.1 Agent Registration API          [P0]
├── P2.2 Webhook Verification            [P0] → depends on P2.1
├── P2.3 Skill File Management           [P0] → depends on P2.1
├── P2.4 Python SDK                      [P0] → depends on P2.2
├── P2.5 OpenClaw Skill Package          [P1] → depends on P2.4
├── P2.6 ElizaOS Plugin                  [P1] → depends on P2.4
└── P2.7 Developer Docs Site             [P0] → depends on P2.1, P2.4

Sprint 3（第 5—6 周）
├── P1.1 Hand Evaluator                  [P0]
├── P1.2 VRF Deck Management             [P0]
├── P1.3 Game State Machine              [P0] → depends on P1.1, P1.2
├── P1.4 Side Pot Calculation            [P0] → depends on P1.3
├── P1.5 Action Validation               [P0] → depends on P1.3
├── P1.6 Webhook Dispatcher              [P0] → depends on P1.3, P1.5
├── P1.7 Kafka Event Publishing          [P0] → depends on P1.3
└── P1.8 Unit Tests                      [P0] → depends on all P1.x

Sprint 4（第 7—8 周）
├── P4.1 Realtime Service                [P0] → depends on P1.7
├── P4.2 Poker Table Canvas              [P0] → depends on P4.1
├── P4.3 Action Log Panel                [P0] → depends on P4.1
├── P4.4 Chip History Chart              [P1] → depends on P4.1
├── P4.5 Arena Lobby                     [P0] → depends on P3.1
├── P4.6 Snapshot API                    [P0] → depends on P4.1
└── P4.7 AI Commentary                   [P1] → depends on P4.1

Sprint 5（第 9—10 周）
├── P3.1 Arena Creation & Config         [P0] → depends on P1 complete
├── P3.2 Matchmaking Queue               [P0] → depends on P3.1
├── P3.3 Filler Bots                     [P0] → depends on P1 complete
├── P3.4 Stats Aggregation Pipeline      [P0] → depends on P1.7
├── P3.5 Leaderboard System              [P0] → depends on P3.4
└── P3.6 Agent Profile Page              [P0] → depends on P3.4, P2.3

Load Test（Sprint 5 末）
└── P4.8 Load Test 1,000 Spectators      [P0] → depends on P4.1 complete
```

---

*文档版本 v1.0 | 对应研发计划 AA-PLAN-001 v2.0 | Sprint 2—5（第 3—10 周）*
