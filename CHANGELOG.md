# Changelog

## 0.3.1 - 2026-07-21

- JOURNEY LOADING INDICATOR: finishing a page in a journey now shows an
  unmistakable spinner card ("Loading <next page>…" / "Checking remaining
  pages…") from the moment the round exhausts until the next page unloads -
  never a blank screen.
- DEVICE APPROVE TOGGLE: Approve PC / Approve Mobile (and single Approve)
  buttons toggle - clicking an approved device UNSETS that approval and the
  item returns to pending when it loses full approval. Unsets persist in real
  time (fully-approved rows are cleared and re-written with the remaining
  device approvals + retained note/variant/fingerprint, in queue order).
- AUTO-BUBBLE: switching the viewport to a mobile-ish width (<=767px, e.g.
  devtools responsive emulation) auto-minimizes the panel to the bubble;
  switching back auto-restores. Manual minimize/restore wins until the next
  switch.
- SUB-HIGHLIGHT RENDER FIX: highlight marks live in page content, outside the
  .qar-theme var scope - the 0.3.0 rule depended on un-fallbacked vars and
  computed to NO background (invisible highlights). The rule now carries hard
  var() fallbacks and the overlay mirrors its theme vars onto <html> so marks
  follow the consumer theme.
- ELEMENT-PICK MULTI-SELECT: in note pick-element mode, LEFT click keeps the
  pick-and-exit behavior; RIGHT click picks WITHOUT exiting (native context
  menu suppressed) so several elements can be referenced in a row.
- INSTANT TOOLTIPS: all overlay tooltips are zero-delay CSS tooltips
  ([data-qatip]) instead of the ~500ms native title delay.

## 0.3.0 - 2026-07-21

- NOT-ALTERED POKA-YOKE: every verdict stores a normalized content fingerprint
  (anchored items hash the element innerText; task items their question). A
  re-shown REJECTED item whose content still fingerprints identical gets a
  prominent SYSTEM-COMPUTED "NOT ALTERED since your rejection" badge (+ the
  saved rejection note); a differing fingerprint shows a subtle "changed since
  last review" hint. Judged by hashing, never by an operating agent.
- DEVICE-SPLIT APPROVALS: `devices?: ("pc"|"mobile")[]` (default pc). One
  approve button per required device; the item counts approved and advances
  only when EVERY required device is approved (reject stays whole-item).
  Plain historical approvals are GRANDFATHERED as fully approved; the round
  recomputes device-aware on load. Detected device gets the primary-styled
  hint button (all stay clickable) with per-device tooltips.
- IMMEDIATE JOURNEY NAV: no "page complete" interstitial - finishing a page
  navigates instantly to the next pending page; the completion panel shows
  only when the WHOLE journey is clean.
- SUB-HIGHLIGHT: `highlightWords?: string[]` wraps matching words/phrases
  inside the spotlighted element with a secondary mark.
- CODENAMES + COPY-REF: deterministic two-word codename per (target, itemId)
  shown on the card with a "Copy ref" button; `codenameFor`/`findByCodename`
  resolver exported (client + server) and codenames attached to state GET
  responses.
- MINIMIZE BUBBLE: replaces the 3s peek - the panel collapses to a draggable
  floating bubble (mouse + touch pointer events); tap restores. Panel drag is
  pointer-based now too. Note textarea stretches to fill the card. Tooltips
  on every icon/abbreviation.
- Server: migration 2 adds `fp`, `approved_pc`, `approved_mobile` to
  qa_review_state; state POST accepts `fp` + `approvedDevices`.

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
