# TODOs

Items captured during /plan-eng-review of Agent-Native Onboarding Protocol.

---

## [Build in CLI PR] Mock HTTP + Socket.IO test server

**What:** A minimal in-process mock server (`node:http` + `socket.io`) for integration tests. Handles: wallet/session bootstrap endpoints, arena list/create/join, runtime get, socket subscription with synthetic `agent:turn_request` events.

**Why:** `smoke full` and the full onboarding flow can't be tested without hitting production. Unit tests with mocked `requestJson` cover most code paths, but the integration path (wallet → session → arena → runtime → turn → submit) requires a real socket interaction.

**Pros:** CI-safe, no production leaks, enables regression tests for the full protocol chain.

**Cons:** ~30 min with CC. Increases test surface to maintain.

**Context:** Decided during /plan-eng-review to include in this CLI PR. Test files in `sdks/agent-skill/test/`.

**Depends on:** CLI PR (implement alongside)

---

## TODO: Specify lastProcessedTurnId server-side behavior

**What:** Formally define `lastProcessedTurnId` on the `GET /arenas/{id}/runtime` response envelope — when is it set, how long does it persist, does it survive reconnects?

**Why:** `protocol resume` uses this field to deduplicate turn submissions after a crash. Without a clear spec, the dedup logic is untestable and the field may not exist when the API PR ships.

**Pros:** Makes `protocol resume` dedup logic verifiable. Prevents a silent "always resubmit" fallback that could cause 409 storms.

**Cons:** Small spec effort in the API PR.

**Context:** Captured during cross-model review (Codex found the field was "named, not specified" in the design doc). Must be specced in the API PR that lands before the CLI PR.

**Depends on:** API PR (tier, isSmoke, lastProcessedTurnId)

---

## TODO: Verify packages/types + SDK compat for new API fields

**What:** After adding `tier`, `isSmoke`, and `lastProcessedTurnId` to the API, run `tsc --noEmit` for `packages/types`, `sdks/openclaw`, and `sdks/elizaos` to confirm no compilation breaks.

**Why:** New fields must be additive/optional. If `packages/types` exposes them as required, all downstream SDK clients break immediately.

**Pros:** Prevents cross-package drift on merge day.

**Cons:** ~15 min of CI verification.

**Context:** Codex flagged this as an understated sequencing risk (finding #9). The shared type definitions in `packages/types/src/index.ts` are consumed by OpenClaw and ElizaOS.

**Depends on:** API PR

