# Changelog

## 0.3.7 - 2026-07-30

- MOBILE PREVIEW SCROLLS TO THE ITEM: the phone-frame iframe loaded each page
  at its top, so opening the preview showed the header rather than the section
  under review. scrollPreviewToSelector() now reaches into the same-origin
  frame and centres the current item's element. It RETRIES rather than
  scrolling once, because the iframe fires load before hydration and before
  images settle and an early scroll gets undone by the layout shift that
  follows; it keeps scrolling for a couple of rounds after a successful hit for
  the same reason, and is bounded at 12 attempts so a genuinely absent element
  (desktop-only items) cannot loop forever. Returns a cleanup that cancels
  pending retries.
- Wired both on iframe load (opening the preview) and on a selector-keyed
  effect (advancing to the next item while the preview stays open, where the
  iframe is deliberately not reloaded and load never fires again).

## 0.3.6 - 2026-07-21

- MOBILE PREVIEW LIVE VARIANT UPDATE: picking a variation while the phone-frame
  preview is OPEN now applies the new variant inside the iframe without a
  close+reopen. The parent posts a same-origin variant message to the iframe;
  the embedded (dormant) overlay runs the item's OWN variation callback there,
  so the DOM mutation executes in the iframe document. The frame also syncs the
  current variant on load. New exports: postVariantToPreview, parseVariantMessage.
- MINIMIZE BUBBLE DOCKS LEFT: the floating bubble now defaults to the LEFT side
  of the screen when minimized (still fully draggable).

## 0.3.5 - 2026-07-21

- JOURNEY PRELOAD: within the final 2 items of a round the overlay prefetches
  the other pages' pending counts in the background and warms the likely next
  page with a <link rel="prefetch"> hint. Round exhaustion then navigates
  INSTANTLY on the cached result (30s freshness window; stale/missing falls
  back to the on-demand fetch + loading card).
- MOBILE PREVIEW: a panel button renders the current page in a phone-sized
  (390x844) framed same-origin iframe on a dimmed backdrop - Approve Mobile
  without devtools. The QA card stays usable on top; a close control (or the
  toggle) returns to normal. The iframe URL keeps the QA params plus a
  qaMobilePreview marker that keeps the embedded overlay dormant.
- ROUND-SCOPED COUNTERS: the finish panel now leads with THIS ROUND's
  approved/rejected (verdicts recorded in this run); ledger totals moved to a
  smaller line labeled "all-time on this page". The footer decided-counter is
  session-based and the approved total is labeled "approved all-time".

## 0.3.4 - 2026-07-21

- TOOLTIP DE-NESTING: exactly one tooltip per hover point. Container elements
  no longer carry tooltips that overlap a child control's (Copy-ref row ->
  codename span; card header -> counter; bubble -> single carrier), plus a
  CSS :has() guard suppresses any ancestor tooltip while a descendant tooltip
  target is hovered. Rendered-DOM invariant test: no [data-qatip] element may
  have a [data-qatip] ancestor.
- COPY-REF FORMAT: the copied reference is now brace-wrapped:
  `{ qa-ref: <codename> | <target> # <itemId> | <title> }`.
- Robustness: the auto-bubble listener no-ops when matchMedia is unavailable.

## 0.3.3 - 2026-07-21

- RE-QUEUE CONTEXT: invalidation (state POST verdict:null) accepts an optional
  `revisitReason`. With a reason the row is KEPT - verdict moves to
  prev_verdict, note + fingerprint stay, reason is stored - and the card for
  the re-queued item prominently shows "Back for review: <reason>" plus
  "Your last verdict: <verdict> - '<note>'", combined with the fingerprint
  badges (NOT ALTERED / changed). No reason + changed fingerprint shows a
  generic "Content changed since your last review." Recording a new verdict
  consumes the context; verdict:null WITHOUT a reason keeps the old
  hard-delete (undo). State GET returns revisitReason + prevVerdict for
  audits. Migration id 3: revisit_reason + prev_verdict columns.

## 0.3.2 - 2026-07-21

- CRITICAL journey fix: the walkthrough ping-ponged forever between a page
  with fresh REJECTS and the next page (rejected items counted as pending for
  navigation, so wraparound kept returning to them). Navigation-pending is now
  UNVERDICTED only (no verdict and no device approvals) - approve, reject,
  and partial device states all count as handled for the current run.
  Rejected items still re-enter FUTURE rounds (round/ledger semantics
  unchanged); the journey-complete panel shows when every page has zero
  unverdicted items. New `countUnverdicted` export.

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
