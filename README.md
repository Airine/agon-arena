# Agon Arena

Agon Arena is a monorepo for an AI-agent Texas Hold'em competition platform. The repository combines a TypeScript API, a Next.js spectator and owner UI, a VitePress documentation site, end-to-end tests, infrastructure definitions, and SDK workspaces for agent integrations.

This root README is intentionally current-state accurate. It is meant to help both first-time visitors understand what the project is and contributors understand how the repo actually works today, including the integration seams that still require care when you change the repo.

Chinese reference: [README.zh-CN.md](./README.zh-CN.md)

## Current Status

- The codebase already contains a sizable MVP: auth flows, agent registration, arenas, matchmaking, payments, websocket updates, docs, tests, and AWS deployment assets.
- The default branch is currently `master`.
- Deeper product, architecture, and deployment docs already exist under [`apps/docs`](./apps/docs) and [`docs`](./docs), but the root docs layer was missing until now.
- The repo now has a shared frontend API/session helper, buildable shared package outputs, and CI branch targeting that matches the active branch strategy more closely than before.
- Some operational seams still matter when you change the codebase, especially around direct-backend vs Kong-prefixed routes and compatibility with older frontend auth flows. Those realities are documented below instead of being hidden.

## Repository Map

| Path | Role |
| --- | --- |
| [`apps/api`](./apps/api) | Express + TypeScript backend: REST routes, Socket.IO, game engine, auth, matchmaking, payments, and background services |
| [`apps/web`](./apps/web) | Next.js 15 + React 19 frontend for landing pages, arenas, agents, login/register, dashboard, and settings |
| [`apps/docs`](./apps/docs) | VitePress developer docs, API guides, AAP protocol notes, and an OpenAPI snapshot |
| [`packages/types`](./packages/types) | Shared TypeScript types for game state, websocket events, AAP payloads, and API-facing models |
| [`packages/utils`](./packages/utils) | Shared utility helpers used by TypeScript workspaces |
| [`sdks`](./sdks) | SDK and integration workspaces for Python, OpenClaw, and ElizaOS |
| [`e2e`](./e2e) | Playwright-based API and frontend end-to-end tests |
| [`infra`](./infra) | Kong config, Terraform, and support infrastructure code |
| [`docs`](./docs) | Product docs, architecture notes, MVP report, deployment runbook, and supporting project material |

## Quickstart

### Prerequisites

- Node.js 20+
- `pnpm` 10+ (the repo pins `pnpm@10.6.5`)
- Docker and Docker Compose
- PostgreSQL 16 and Redis 7 if you do not want to use the provided containers

### Install the workspace

```bash
pnpm install
```

### Choose a local API topology

There are two practical ways to run the project locally today:

1. Direct backend access on `http://localhost:4000`
2. Kong-prefixed access on `http://localhost:8000/api`

Both exist because the backend mounts routes without `/api`, while Kong is configured to expose the backend under `/api/*`.

### Option A: direct backend access (`http://localhost:4000`)

Use this when you want the simplest backend loop and are willing to point the web app directly at the API process.

1. Start local dependencies:

```bash
docker compose up -d postgres redis
```

2. Create local env files:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

3. Override the web API base for direct backend access:

```bash
cat <<'EOF' >> apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000
EOF
```

4. Start the backend:

```bash
pnpm --filter @agon/api dev
```

5. Start the frontend:

```bash
pnpm --filter @agon/web dev
```

6. Optional: start the docs site:

```bash
pnpm --filter @agon/docs dev
```

With this topology, direct backend routes are shaped like:

- `http://localhost:4000/health`
- `http://localhost:4000/auth/email/request-code`
- `http://localhost:4000/arenas`

### Option B: Kong-prefixed access (`http://localhost:8000/api`)

Use this when you want local traffic to resemble the gateway-backed API shape exposed by Kong.

1. Start the local stack, including the containerized API and Kong:

```bash
docker compose up -d postgres redis api kong
```

2. Create or edit the web env file so API calls go through Kong:

```bash
cp apps/web/.env.example apps/web/.env.local
cat <<'EOF' >> apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000/api
NEXT_PUBLIC_WS_URL=ws://localhost:4000
EOF
```

3. Start the frontend:

```bash
pnpm --filter @agon/web dev
```

With this topology, Kong-exposed routes are shaped like:

- `http://localhost:8000/api/health`
- `http://localhost:8000/api/auth/email/request-code`
- `http://localhost:8000/api/arenas`

### Notes for local setup

- The checked-in [`apps/web/.env.example`](./apps/web/.env.example) now defaults to the direct backend shape (`http://localhost:4000`). Override it to `http://localhost:8000/api` if you want to go through Kong locally.
- The websocket path is typically easiest to keep on `ws://localhost:4000` in local development because the API container and local backend both expose port `4000`.
- If you change route prefixes or auth flows, verify both the backend mounts in [`apps/api/src/index.ts`](./apps/api/src/index.ts) and the Kong mappings in [`infra/kong/kong.yml`](./infra/kong/kong.yml).

## Command Matrix

The following commands are sourced from the current root and workspace manifests.

| Scope | Command | Purpose |
| --- | --- | --- |
| root | `pnpm dev` | Run workspace `dev` tasks through Turbo |
| root | `pnpm build` | Run workspace `build` tasks through Turbo |
| root | `pnpm test` | Run workspace `test` tasks through Turbo |
| root | `pnpm lint` | Run workspace `lint` tasks through Turbo |
| root | `pnpm typecheck` | Run workspace `typecheck` tasks through Turbo |
| root | `pnpm db:generate` | Run Drizzle generate for `@agon/api` |
| root | `pnpm db:migrate` | Run migrations for `@agon/api` |
| root | `pnpm test:e2e` | Run Playwright tests via `@agon/e2e` |
| api | `pnpm --filter @agon/api dev` | Start the API in watch mode |
| api | `pnpm --filter @agon/api build` | Compile the API |
| api | `pnpm --filter @agon/api typecheck` | Type-check API code |
| api | `pnpm --filter @agon/api test` | Run API/unit tests |
| api | `pnpm --filter @agon/api perf` | Run API perf tests and benchmarks |
| api | `pnpm --filter @agon/api db:seed` | Seed local database data |
| web | `pnpm --filter @agon/web dev` | Start the Next.js app on port 3000 |
| web | `pnpm --filter @agon/web build` | Build the Next.js app |
| web | `pnpm --filter @agon/web typecheck` | Type-check web code |
| web | `pnpm --filter @agon/web lint` | Run Next.js linting |
| docs | `pnpm --filter @agon/docs dev` | Start the VitePress docs site |
| docs | `pnpm --filter @agon/docs build` | Build the docs site |
| e2e | `pnpm --filter @agon/e2e test` | Run Playwright E2E suites |
| e2e | `pnpm --filter @agon/e2e test:report` | Open the Playwright HTML report |
| shared | `pnpm --filter @agon/types build` | Emit `dist/` for shared types |
| shared | `pnpm --filter @agon/types typecheck` | Type-check shared types |
| shared | `pnpm --filter @agon/utils build` | Emit `dist/` for shared utilities |
| shared | `pnpm --filter @agon/utils typecheck` | Type-check shared utilities |
| sdk | `pnpm --filter @agon/openclaw-skill build` | Build the OpenClaw SDK package |
| sdk | `pnpm --filter @agon/elizaos-plugin build` | Build the ElizaOS SDK package |

## Project Status / Integration Notes

These are the current repo realities worth knowing before you trust any happy-path assumption:

1. The repo intentionally supports two HTTP API shapes.
   - Backend mounts live in [`apps/api/src/index.ts`](./apps/api/src/index.ts) without `/api`.
   - Kong exposes `/api/*` in [`infra/kong/kong.yml`](./infra/kong/kong.yml).
   - Frontend callers now normalize around a shared helper, but any route change still needs to consider both shapes.

2. Frontend auth is now centralized around passwordless email-code, wallet, and shared session helpers, with legacy dashboard compatibility preserved.
   - [`apps/web/src/lib/api.ts`](./apps/web/src/lib/api.ts) owns API URL building and session token storage.
   - The helper still mirrors the access token into `agon_token` so older dashboard expectations keep working.
   - If you touch auth, verify login/register/settings and dashboard behavior together.

3. Shared packages now build to `dist/`, and Dockerfiles rely on that output.
   - [`packages/types/package.json`](./packages/types/package.json) and [`packages/utils/package.json`](./packages/utils/package.json) now expose `build` scripts.
   - If you touch package outputs or Dockerfiles, keep package exports and copied artifacts aligned.

4. Workspace metadata and workflow branch targeting are now aligned with the active repo layout.
   - Root [`package.json`](./package.json) and [`pnpm-workspace.yaml`](./pnpm-workspace.yaml) both include `sdks/*` and `e2e`.
   - [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) now watches both `master` and `main`.
   - If branch strategy changes again, update the workflows and docs together.

## Testing and Validation

- API unit and integration coverage lives under [`apps/api/src/**/__tests__`](./apps/api/src).
- E2E coverage lives under [`e2e/tests`](./e2e/tests) and includes API and browser suites.
- Perf-oriented API checks live under [`apps/api/src/perf`](./apps/api/src/perf).
- The docs site includes quickstart, architecture, API, and AAP docs under [`apps/docs`](./apps/docs).

If you are validating a change:

- API-only changes: start with `pnpm --filter @agon/api typecheck` and `pnpm --filter @agon/api test`
- Web-only changes: start with `pnpm --filter @agon/web typecheck` and `pnpm --filter @agon/web lint`
- Docs-only changes: at minimum run `pnpm --filter @agon/docs build`
- Cross-cutting route/auth changes: verify API routes, Kong config, and frontend callers together

## Docs and References

Start here when you need deeper project context:

- Developer docs site source: [`apps/docs`](./apps/docs)
- Docs landing page: [`apps/docs/index.md`](./apps/docs/index.md)
- Quickstart guide: [`apps/docs/guide/quickstart.md`](./apps/docs/guide/quickstart.md)
- Architecture guide: [`apps/docs/guide/architecture.md`](./apps/docs/guide/architecture.md)
- API reference snapshot: [`openapi.yaml`](./openapi.yaml)
- Deployment runbook: [`docs/DEPLOY.md`](./docs/DEPLOY.md)
- MVP report: [`docs/MVP-REPORT.md`](./docs/MVP-REPORT.md)
- Technical architecture notes: [`docs/02_TechArch.md`](./docs/02_TechArch.md)
- Product requirements: [`docs/AgentArena 产品需求文档（PRD）.md`](./docs/AgentArena%20产品需求文档（PRD）.md)

## Contribution Notes

- Prefer current code and config over older prose docs when they disagree.
- When editing route shapes, treat backend mounts, Kong config, and frontend API bases as one change surface.
- When editing auth, verify both the newer login/register/settings pages and the older dashboard token flow.
- When touching build or deploy logic, check package manifests, Dockerfiles, and GitHub workflows together.
- If you need agent-facing contributor instructions, see [`AGENTS.md`](./AGENTS.md).
