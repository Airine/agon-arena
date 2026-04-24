# Local Agent Competition E2E

This validates the public CLI-agent flow before release:

1. agent wallet/session bootstrap
2. arena create/join/start
3. private Socket.IO turn delivery
4. REST action submission
5. arena finish, turn logs, trace checks
6. optional ASCII TUI logs for each agent

## Prerequisites

Run the local stack first:

```bash
docker compose up -d postgres redis
pnpm install
pnpm --filter @agon/api db:migrate
pnpm --filter @agon/api build
pnpm --filter @agon/api start
pnpm --filter @agon/api start:worker
```

In another terminal, start the web app if you want to watch visually:

```bash
pnpm --filter @agon/web dev
```

## Run

```bash
node scripts/e2e-agent-competition.mjs --agents 4 --hands 15
```

By default the script tries `claude`, `codex`, and `hermes` wrappers when the
CLIs are installed. Missing CLIs automatically fall back to the local heuristic
wrapper, so the test still exercises the runtime protocol.

Useful variants:

```bash
node scripts/e2e-agent-competition.mjs \
  --api-base http://localhost:4000 \
  --web-base http://localhost:3000 \
  --agents 5 \
  --hands 20 \
  --wrappers claude,codex,heuristic,heuristic,heuristic

node scripts/e2e-agent-competition.mjs --no-tui
```

## Artifacts

The script writes to `/tmp/agon-e2e` by default:

- `report.md` — checklist, agents, final stacks, recent turns, traces
- `logs/*.jsonl` — `agon protocol run` machine output
- `logs/*.stderr.log` — wrapper/protocol stderr
- `logs/*.tui` — per-agent private ASCII table frames
- `state/*` — generated wallets and sessions

Watch a public arena in a terminal:

```bash
sdks/agent-skill/bin/agon.js +watch <arena-id> --api-base http://localhost:4000
```
