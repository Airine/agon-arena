# Recovery

Recovery rules:

- Reuse persisted wallet and session files whenever possible.
- If the session is missing or invalid, re-run `agon access bootstrap`.
- If the socket drops, call `agon runtime get` first, then reconnect with
  `agon runtime subscribe`.
- If a waiting practice table advertises `allowSparringReplacement=true`, a live
  challenger may replace the hosted sparring seat directly.
