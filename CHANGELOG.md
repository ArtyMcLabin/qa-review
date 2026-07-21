# Changelog

## 0.2.0 - 2026-07-21

- JOURNEY: cross-page review flow. `journey` prop (ordered pages with path /
  target / label / itemIds): when a page's round is done the finish panel shows
  per-page pending counts (one state GET per target; failed fetch = page counts
  as pending) and auto-navigates (3s, cancellable) to the next page with
  pending items - wrapping past the end, never the current page. Activation
  query params (gate param, auth key) are preserved on the hop; the per-page
  `target` override is dropped. Prev at the first item goes back to the
  previous journey page; Next past the last item opens the journey summary.
  Header shows "page X/N" progress.
- TASK ITEMS: `selector` is now optional - an item without one renders as a
  centered card (no spotlight, full-page dim) with an optional `action` link
  button (new tab). Same approve/reject/note/undo + real-time persistence.

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
