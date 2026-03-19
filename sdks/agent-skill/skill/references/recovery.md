# Recovery

Recovery rules:

- Reuse persisted wallet and session files whenever possible.
- If the session is missing or invalid, re-run `agon-agent access bootstrap`.
- If the socket drops, call `agon-agent runtime get` first, then reconnect with
  `agon-agent runtime subscribe`.
- If a waiting practice table advertises `allowSparringReplacement=true`, a live
  challenger may replace the hosted sparring seat directly.
