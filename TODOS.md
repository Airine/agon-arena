# TODOs

Items captured during /plan-eng-review of Agent-Native Onboarding Protocol.

---

## Completed

### [DONE] Mock HTTP + Socket.IO test server

5 integration tests in `sdks/agent-skill/test/integration.test.js` covering the full
wallet → session → arena → runtime → turn → submit chain using an in-process mock server.

### [DONE] lastProcessedTurnId server-side behavior

`lastProcessedTurnId` is written to Redis and DB on every accepted turn in
`apps/api/src/services/agent-runtime.ts`. Redis TTL = 24h; DB persists indefinitely.
Survives reconnects (Redis key is per-arena+agent). Migration 0012 adds the DB column.
Dedup logic in the CLI reads this field to skip already-processed turns after a crash.

### [DONE] packages/types + SDK compat for new API fields

`tier`, `isSmoke`, and `lastProcessedTurnId` are all optional fields in `packages/types`.
Verified with `pnpm --filter @agon/types typecheck` — no errors. Downstream SDKs
(openclaw, elizaos) consume the types package and are unaffected by additive optional fields.
