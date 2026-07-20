# Changelog

## 0.1.1 - 2026-07-21

- REAL-TIME persistence unified across consumers (SSoT fix): every
  approve/reject, note change (debounced, default 600ms), and undo writes to
  the server ledger immediately; the session-snapshot submit is optional
  either way.
- Write-behind offline resilience: failed server writes queue in localStorage
  (survive reloads), replay in order on the next action, and hydration replays
  still-pending ops over the server map so an offline verdict is never
  clobbered or lost silently.
- Finish panel unified: the auto-saved note always shows and the copy button
  is canonically labeled "Copy JSON" in all configurations.

## 0.1.0 - 2026-07-21

- Initial release: spotlight QA review overlay (round-based review frozen at
  load, fixed denominator, undo, 3s peek, element-picker notes, design
  variations, keyboard driving), client verdict store (localStorage cache +
  durable server mirror, single-item invalidation, no reset-all), server
  handler factory (state ledger, session submit, sessions list, access probe,
  BYO `authorize`), self-provisioning Postgres storage with `site` scoping.
