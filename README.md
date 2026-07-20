# qa-review

Interactive on-page QA review for React apps: a spotlight walkthrough overlay
that steps a reviewer through the elements of a real rendered page
(approve / reject / note / undo / design-variation picking), plus a durable
server-side verdict ledger with a self-provisioning Postgres store.

Built for "founder reviews the page element by element" workflows: the reviewer
opens the live page, the overlay dims everything except the current item, and
every verdict is persisted immediately - refreshes, storage wipes, and device
switches never lose progress.

## Features

- **Spotlight walkthrough** - dims the page except the current `[data-qa]`
  target; card shows title/subtitle + Approve/Reject/Prev/Next.
- **Round-based review** - the set of actionable (not-yet-approved) items is
  frozen at load with a fixed denominator ("1 of N"), so approved items never
  re-appear mid-round.
- **Durable verdict ledger** - verdicts are saved per item as you go
  (localStorage cache + server ledger). No bulk reset exists; a single item is
  re-queued by invalidating just it (`verdict: null`).
- **Undo, Peek (3s clean-page view), element-picker notes, keyboard driving**
  (A/R/arrows/U/Esc), draggable panel.
- **Design variations** - an item can expose N live-swappable variants; the
  chosen variant is recorded with the approval.
- **Session snapshots** - optional "Save review to database" submit that stores
  the full run (summary + per-item results) for auditability.
- **BYO auth** - the server handlers take an `authorize(req)` callback; plug in
  any gate (SSO, password, none for local tools). Fail-closed.
- **Self-provisioning Postgres storage** - the adapter creates its own
  `qa_review_*` tables on first use (versioned, advisory-locked). A `site`
  scope column lets one database serve many installs.
- **No CSS toolchain required** - the overlay injects its own stylesheet;
  brand colors come from a small theme prop.

## Install

Not yet on npm. Install from git:

```bash
npm install github:ArtyMcLabin/qa-review
# or
pnpm add github:ArtyMcLabin/qa-review
```

For CI environments without access to this repository, vendor a tarball:

```bash
# in this repo
npm pack   # -> artymclabin-qa-review-<version>.tgz
# in the consumer
pnpm add ./vendor/artymclabin-qa-review-<version>.tgz
```

Peer dependencies: `react`, `react-dom`, `lucide-react`.

## Quick start (Next.js App Router)

### 1. Server: mount the handlers

```ts
// src/lib/qa-review.ts
import { createQAReviewHandlers } from "@artymclabin/qa-review/server";

export const qaHandlers = createQAReviewHandlers({
  site: "example-site", // scope for this install (one DB can serve many)
  authorize: async (req) => {
    const user = await verifyMySession(req); // your gate; null -> 401
    return user ? { reviewer: user.name, displayName: user.name } : null;
  },
});
```

```ts
// src/app/api/qa/state/route.ts
import { qaHandlers } from "@/lib/qa-review";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = qaHandlers.stateGET;
export const POST = qaHandlers.statePOST;
```

Mount `submitPOST`, `sessionsGET`, and `accessGET` the same way on their own
routes as needed.

### 2. Database

Set the connection string (any Postgres - local, Neon, Supabase, RDS):

```bash
QA_REVIEW_DATABASE_URL=postgresql://user:password@db.example.com/mydb
```

No migrations to write: on the first request the adapter provisions
`qa_review_state` (the per-item ledger), `qa_review_sessions` (session
snapshots), and `qa_review_migrations` (its own version bookkeeping).

### 3. Client: mark targets and mount the overlay

```tsx
// Any element you want reviewed gets a stable [data-qa] anchor:
<section data-qa="hero">...</section>
```

```tsx
"use client";
import { QAReviewOverlay } from "@artymclabin/qa-review";

const ITEMS = [
  { id: "hero", title: "Hero headline", selector: '[data-qa="hero"]' },
  { id: "pricing", title: "Pricing table", sub: "Check the currency.", selector: '[data-qa="pricing"]' },
];

export function PageQA() {
  return (
    <QAReviewOverlay
      items={ITEMS}
      target="example-site:/pricing" // one ledger bucket per reviewed surface
      gateParam="qaReview"           // omit if activation is gated upstream
      submitUrl="/api/qa/submit"     // omit to hide the session-save button
      theme={{ accent: "#ffde4d" }}
    />
  );
}
```

## API sketch

```ts
// client
import {
  QAReviewOverlay, // the overlay component
  createQAStore,   // per-target verdict store (localStorage + server mirror)
  targetFromLocation, // ?target= override helper (E2E isolation)
} from "@artymclabin/qa-review";

// server
import {
  createQAReviewHandlers, // { stateGET, statePOST, submitPOST, sessionsGET, accessGET }
  createPostgresStorage,  // default storage; implement QAReviewStorage to swap
} from "@artymclabin/qa-review/server";
```

State endpoint semantics (the ledger):

- `GET ?target=...` -> `{ ok, verdicts: { itemId: { verdict, note, variant } } }`
- `POST { target, itemId, verdict | note | variant }` -> merge-upsert one item
- `POST { target, itemId, verdict: null }` -> delete that one item
  (re-queues it on the next round). There is deliberately **no reset-all**.

## License

MIT
