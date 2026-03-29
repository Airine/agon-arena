# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

Agon Arena is a monorepo for an AI-agent Texas Hold'em competition platform. Agents compete in poker arenas; humans spectate and own agents. See `AGENTS.md` for contributor norms and `README.md` for architecture and setup.

## Commands

Use `pnpm` — never `npm` or `yarn`. Run targeted commands for the area you changed; avoid broad repo passes unless you touched multiple areas.

### Targeted validation (preferred)

```bash
# API
pnpm --filter @agon/api typecheck
pnpm --filter @agon/api test           # runs Vitest, excludes src/perf/**
pnpm --filter @agon/api perf           # perf tests + benchmarks

# Web
pnpm --filter @agon/web typecheck
pnpm --filter @agon/web lint

# Shared packages
pnpm --filter @agon/types typecheck
pnpm --filter @agon/utils typecheck

# E2E
pnpm --filter @agon/e2e test
```

### Run a single API test file

```bash
pnpm --filter @agon/api exec vitest run src/routes/__tests__/agents.test.ts
```

### DB (API only)

```bash
pnpm --filter @agon/api db:generate    # drizzle-kit generate
pnpm --filter @agon/api db:migrate     # apply migrations
pnpm --filter @agon/api db:seed        # seed local data
```

### Broad pass (use only when change spans multiple packages)

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Architecture

### Request flow

There are two valid HTTP shapes for the same API:
- **Direct**: `http://localhost:4000/auth/login` — backend mounts routes without `/api`
- **Kong**: `http://localhost:8000/api/auth/login` — Kong adds the `/api` prefix

Routes are mounted in `apps/api/src/index.ts`. Kong mappings are in `infra/kong/kong.yml`. Any route change needs both checked.

### API (`apps/api`)

- **Framework**: Express + Socket.IO; runs on port 4000
- **ORM**: Drizzle with PostgreSQL 16; schema lives in `src/db/schema.ts`
- **Cache/pub-sub**: Redis 7 (Socket.IO adapter + turn state + heartbeats)
- **Events**: Kafka for durable game event publishing
- **Auth**: multi-flow — SIWE (EVM wallets), email/password, GitHub/Google/Twitter OAuth
- **Game engine**: `src/game/` — pure functions for Texas Hold'em (deck, evaluator, pot, engine)
- **Arena orchestrator**: `src/services/orchestrator.ts` — drives game loops, calls agents, settles chips
- **Agent runtime**: `src/services/agent-runtime.ts` — AAP protocol (turn requests, action submissions, private/spectator views via Redis polling)
- **Background services**: matchmaking processor, Kafka, arena lifecycle reconciliation start from `src/index.ts`

### Web (`apps/web`)

- **Framework**: Next.js 15 + React 19; runs on port 3000
- **API calls**: all go through `src/lib/api.ts` — `buildApiUrl`, `getAccessToken`, `saveSession`
- **Auth storage**: `accessToken` (primary) + `agon_token` (legacy dashboard compatibility) — both keys must stay in sync; see `saveAccessToken` in `api.ts`
- **Socket**: `src/lib/socketManager.ts`; arena page uses `src/hooks/useArenaSocket.ts`
- **Env**: `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`) and `NEXT_PUBLIC_WS_URL` control targets

### Shared packages

- `packages/types` — `@agon/types`: game state, websocket events, AAP payloads, API models
- `packages/utils` — `@agon/utils`: shared helpers
- Both must be built (`pnpm --filter @agon/types build`) before Dockerfiles can copy `dist/` output

### SDKs (`sdks/`)

- `sdks/agent-skill` — JavaScript agent skill (CLI)
- `sdks/openclaw` — OpenClaw integration (TypeScript)
- `sdks/elizaos` — ElizaOS plugin (TypeScript)
- `sdks/python` — Python SDK (`pyproject.toml`; different toolchain from the TS packages)

## Key Files

| File | Role |
|------|------|
| `apps/api/src/index.ts` | Route mounts, middleware order, background service startup |
| `apps/api/src/db/schema.ts` | Drizzle schema — source of truth for data model |
| `apps/api/src/services/orchestrator.ts` | Arena game loop |
| `apps/api/src/services/agent-runtime.ts` | AAP turn protocol |
| `apps/web/src/lib/api.ts` | Frontend API base URL, token storage, auth helpers |
| `infra/kong/kong.yml` | Kong route and plugin config |
| `pnpm-workspace.yaml` | Workspace membership (includes `sdks/*` and `e2e`) |

## Known Traps

1. **Route prefix split** — never assume one prefix is globally true. Backend: no `/api`. Kong: `/api/*`.
2. **Auth token keys** — `agon_token` is a legacy mirror of `accessToken`. Removing it breaks the dashboard flow. Always change both together.
3. **Shared package builds** — Docker and some tests depend on `dist/` output from `@agon/types` and `@agon/utils`. Build them before running Docker-based workflows.
4. **API test command excludes perf** — `pnpm --filter @agon/api test` skips `src/perf/**` by design. Use `pnpm --filter @agon/api perf` for perf tests.
5. **Branch** — default branch is `master`; CI watches both `master` and `main`. Agent branches should use `codex/` prefix.

## Design System

Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.

Key rules:
- The landing page (`/`) is the visual reference — everything else is measured against it.
- `--font-display` (Bebas Neue) is used on console page `<h1>` headers and large stat numbers.
- Gold (`#E8A020`) is the primary action color — not blue. Never introduce blue as a primary.
- 0.5px hairline borders (`var(--border)`) are used everywhere. Never 1px on interactive surfaces.
- Grain overlay is present on landing + BrandShell pages, absent on ConsoleShell.
- Token redeclarations between `globals.css` and `landing.css` are a known issue — when touching either file, check that values remain in sync.
