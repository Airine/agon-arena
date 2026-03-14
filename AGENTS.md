# AGENTS.md

This file is for coding agents and maintainers working inside the `agon-arena` repository. Follow the live repo state, not the idealized product story.

> 中文说明：这份文件面向在 `agon-arena` 仓库内工作的代码智能体和维护者。请优先遵循仓库当前真实状态，而不是理想化的产品描述。

## Purpose and Surface Area

Agon Arena is a monorepo for an AI-agent poker competition platform. The core working surface is:

- `apps/api`: Express API, Socket.IO, game engine, auth, matchmaking, payments
- `apps/web`: Next.js frontend for spectators, owners, login/register, settings
- `apps/docs`: VitePress docs and API-facing documentation
- `packages/types` and `packages/utils`: shared TypeScript packages
- `sdks/*`: integration packages for Python, OpenClaw, and ElizaOS
- `e2e`: Playwright API/browser suites
- `infra`: Kong and Terraform

> 中文说明：这个仓库的主要工作面就是上面这些目录。大多数改动都会落在 `apps/api`、`apps/web`、`infra` 和文档之间的联动，而不是单点孤立修改。

## Source of Truth Order

When sources disagree, use this order:

1. Live code and config
2. Package manifests and workspace definitions
3. Gateway and deployment config
4. Tests
5. Documentation prose

Concrete anchors in this repo:

- Route mounts: [`apps/api/src/index.ts`](./apps/api/src/index.ts)
- Kong path mapping: [`infra/kong/kong.yml`](./infra/kong/kong.yml)
- Frontend API helper: [`apps/web/src/lib/api.ts`](./apps/web/src/lib/api.ts)
- Workspace membership: [`pnpm-workspace.yaml`](./pnpm-workspace.yaml)
- Root scripts: [`package.json`](./package.json)
- Secondary docs: [`apps/docs`](./apps/docs) and [`docs`](./docs)

Treat `openapi.yaml`, VitePress pages, and older product docs as secondary to the actual route implementations and current configs.

> 中文说明：如果多个来源互相冲突，优先级是“真实代码/配置”高于“文档描述”。在这个仓库里，尤其要先看 `apps/api/src/index.ts`、`infra/kong/kong.yml`、`apps/web/src/lib/api.ts` 和 `pnpm-workspace.yaml`，不要先相信 `openapi.yaml` 或旧的产品文档。

## Working Norms

- Use `pnpm` for Node/TypeScript workspaces.
- Prefer targeted validation for the area you changed before running broad repo-wide checks.
- Keep docs current-state accurate. Do not describe a path as working unless you verified it against code or config.
- When a change crosses API, web, and infra boundaries, treat it as one integrated change surface.
- If you create an assistant-owned branch, prefer a `codex/` prefix. The current default branch is `master`, and CI now watches both `master` and `main`.

> 中文说明：Node/TS 工作区统一使用 `pnpm`。先做与你改动范围匹配的定向验证，不要一上来就假设全仓库路径都通。跨 API、前端、网关的改动必须一起看。当前默认分支是 `master`；如果智能体需要建分支，优先使用 `codex/` 前缀。

## Validation by Area

Use the smallest command set that matches the files you touched.

| Area | Preferred commands |
| --- | --- |
| API | `pnpm --filter @agon/api typecheck`, `pnpm --filter @agon/api test` |
| API perf work | `pnpm --filter @agon/api perf` |
| Web | `pnpm --filter @agon/web typecheck`, `pnpm --filter @agon/web lint` |
| Docs site | `pnpm --filter @agon/docs build` |
| E2E | `pnpm --filter @agon/e2e test` |
| Shared TS packages | `pnpm --filter @agon/types typecheck`, `pnpm --filter @agon/utils typecheck` |
| SDKs | `pnpm --filter @agon/openclaw-skill build`, `pnpm --filter @agon/elizaos-plugin build` |
| Broad repo pass | `pnpm lint`, `pnpm typecheck`, `pnpm test` |

If your change affects routes, auth, or deployment assumptions, also read the related config files even if you do not edit them.

> 中文说明：优先跑与你改动区域直接对应的命令。比如 API 改动先跑 API 的 `typecheck` 和 `test`，前端改动先跑 web 的 `typecheck` 和 `lint`。如果改动涉及路由、认证或部署假设，就算没有修改对应配置文件，也要把它们读一遍并核对。

## Known Traps in This Repo

### 1. API prefixing is split between backend and gateway

The backend mounts routes without `/api` in [`apps/api/src/index.ts`](./apps/api/src/index.ts), but Kong exposes `/api/*` in [`infra/kong/kong.yml`](./infra/kong/kong.yml).

Implication:

- `http://localhost:4000/auth/login` is the direct backend shape
- `http://localhost:8000/api/auth/login` is the Kong shape

Do not assume one prefix convention is globally true across the repo.

> 中文说明：后端本体和 Kong 的路由前缀不一致。直连后端时没有 `/api`，走 Kong 时有 `/api`。不要默认整个仓库只存在一种前缀形态。

### 2. Frontend auth now uses shared helpers, but legacy compatibility still matters

[`apps/web/src/lib/api.ts`](./apps/web/src/lib/api.ts) now owns API URL building and access-token storage, and older dashboard compatibility is preserved by mirroring the access token into `agon_token`.

Implication:

- A “small” auth change can still break one flow while leaving another apparently working if compatibility behavior is removed accidentally.
- Always verify login/register/settings and dashboard behavior together when touching auth.

> 中文说明：前端认证现在已经通过共享 helper 收口，但为了兼容旧 dashboard，access token 仍会同步写入 `agon_token`。因此认证改动仍可能只影响一部分页面；改动后要把 login/register/settings 和 dashboard 一起验证。

### 3. Workspace and build alignment is better now, but keep the files in sync

`pnpm-workspace.yaml` and the root `package.json` `workspaces` field now both include `sdks/*` and `e2e`.

Also, [`apps/api/Dockerfile`](./apps/api/Dockerfile) and [`apps/web/Dockerfile`](./apps/web/Dockerfile) call `@agon/types build` and `@agon/utils build`, and those packages now expose matching build scripts and `dist/` outputs.

Implication:

- Keep `pnpm-workspace.yaml`, root `package.json`, package exports, and Docker copy assumptions aligned.
- Be careful when editing Docker, CI, or README instructions around build steps.

> 中文说明：工作区边界和构建假设现在已经基本对齐，但这些文件仍要同步维护。`pnpm-workspace.yaml` 和根 `package.json` 都包含 `sdks/*` 与 `e2e`；Dockerfile 依赖 `packages/types` 和 `packages/utils` 的 `build` 脚本及 `dist/` 产物，所以改 package export、构建脚本或镜像复制路径时必须一起核对。

### 4. Branch strategy and workflow targeting are coupled

The repo currently works on `master`, and [`ci.yml`](./.github/workflows/ci.yml) now targets both `master` and `main`.

Implication:

- Do not assume branch naming can change safely without touching workflows and docs.
- If you change CI/CD docs or branch automation, reconcile branch names explicitly.

> 中文说明：仓库当前实际默认分支是 `master`，CI workflow 现在同时监听 `master` 和 `main`。涉及分支策略、自动化或发布触发条件时，不要想当然，必须把 workflow 和文档一起核对。

## Editing Expectations by Subsystem

### API

- If you add or rename a route, update the mount list in [`apps/api/src/index.ts`](./apps/api/src/index.ts).
- If the route is externally consumed, check whether Kong also needs to be updated.
- If auth shape changes, verify affected frontend callers and any docs that mention the route.

> 中文说明：改 API 路由时，不要只改单个 router 文件；还要确认 `index.ts` 的挂载、Kong 的暴露方式，以及前端是否还在按旧路径调用。

### Web

- Check whether the page uses the shared API helper or a page-local fetch path.
- Do not assume all pages share the same auth mechanism.
- Keep route-prefix assumptions explicit in env vars and code comments when necessary.

> 中文说明：前端并不是所有页面都统一走同一个 API helper，也不是所有页面都共享同一个 token 流程。改前端时先看调用路径和 token 读取方式。

### Infra and Deployment

- Keep Kong config, Dockerfiles, and deployment docs aligned.
- When changing environment-variable expectations, update examples and runbooks together.
- Treat workflow files as live config, not documentation.

> 中文说明：基础设施相关改动需要同时看 Kong、Dockerfile、部署文档和 workflow。环境变量一旦变动，示例文件和 runbook 也要同步。

### Docs

- Root docs should describe what works now, plus the known gaps.
- Prefer linking to deeper docs over copying long sections from `docs/` or `apps/docs/`.
- If a doc claim conflicts with code, fix the doc or call out the gap explicitly.

> 中文说明：文档层的目标不是“好看”，而是“准确可执行”。如果代码和文档冲突，要么修正文档，要么明确写出缺口，不要继续传播过时说法。

### SDKs

- Remember that `sdks/python` is Python-based and uses `pyproject.toml`, while the other SDK workspaces are TypeScript packages.
- Do not assume root Turbo coverage is enough for SDK validation.
- Keep SDK docs aligned with the actual API/auth expectations they integrate with.

> 中文说明：`sdks/python` 和另外两个 TypeScript SDK 的工具链不同。不要把所有 SDK 当成同一种工作区处理，也不要默认根级 Turbo 已经覆盖了 SDK 的验证需求。

## Documentation Rule for Agents

When you write or update docs in this repo:

- Prefer “here is how it works today” over “here is how it should work eventually”.
- Mark known gaps plainly.
- Use concrete file references when a future contributor could otherwise follow the wrong path.
- Avoid promising CI, deployment, or build behavior you did not verify.

> 中文说明：在这个仓库写文档时，优先写“今天真实怎么工作”，而不是“未来理想上应该怎么工作”。已知缺口要直接写出来；容易误导后续协作者的地方，要给出明确文件锚点。
