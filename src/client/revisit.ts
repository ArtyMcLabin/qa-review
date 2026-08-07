"use client";

// Re-queue context (0.3.3): when an item is invalidated back into review, the
// card must answer "why am I seeing this again and what changed?" - a reviewer
// paused a review over exactly this gap. The invalidation API carries an
// optional `revisitReason`; the row keeps their prior verdict + note; and the
// fingerprint tells whether the content actually changed since that verdict.
//
// 0.4.0 - ROUND AWARENESS. The above was firing inside a single sitting: a
// reviewer who rejected an item, moved on, then pressed Prev to look at it
// again was told "NOT ALTERED since your rejection" - technically true and
// completely useless, because nobody had been given the chance to alter
// anything yet. Arty, 2026-08-04: "if I reject something, go forward, and then
// go backward, it shows me this even though it's the same iteration right now.
// It should only show this alert if it's a future [round]." A ROUND is one full
// review pass plus the fix pass that answers it - not a page load, not a
// session. So the whole revisit block is suppressed while the stored verdict
// belongs to the round being reviewed right now.

import type { FingerprintStatus } from "./fingerprint.js";

export interface RevisitInfo {
  /** Why the item was re-queued (set by the invalidation call). */
  reason?: string;
  /** The reviewer's verdict before invalidation. */
  prevVerdict?: string;
  /** The reviewer's note from that prior verdict. */
  prevNote?: string;
  /** Review round the prior verdict was given in. Absent on pre-0.4.0 rows. */
  prevRound?: number;
}

export interface RevisitDisplay {
  /** Prominent "Back for review: ..." headline (reason, or generic change note). */
  headline: string | null;
  /** "Your last verdict: reject" - WITHOUT the note (see priorNote). */
  prior: string | null;
  /**
   * The prior note, kept separate so the card can render it COLLAPSED. It used
   * to be inlined into `prior` and repeated again under the NOT-ALTERED badge,
   * so a reviewer read their own note up to three times per card (it also sits
   * in the textarea below). Arty, 2026-08-04: "don't show a copy of it there
   * since the note appears at the bottom anyway ... make the previous rejection
   * note expandable in case I still want to review it."
   */
  priorNote: string | null;
  /** Show the prominent NOT-ALTERED badge (prior REJECT + identical content). */
  notAltered: boolean;
}

/**
 * Pure display logic for a re-queued item. Rules:
 * - SAME ROUND -> nothing at all. Walking back over your own verdicts inside
 *   one pass is navigation, not a revisit.
 * - a provided reason headlines as "Back for review: <reason>";
 * - no reason but a CHANGED fingerprint -> generic "Content changed since
 *   your last review.";
 * - a prior verdict renders as context ("Your last verdict: reject"), with the
 *   note handed back separately for collapsed rendering;
 * - prior REJECT + UNCHANGED fingerprint keeps the system-computed
 *   NOT-ALTERED badge (reason or not - the reviewer must see nothing moved).
 *
 * `currentRound` is the round being reviewed right now. When either side is
 * unknown the comparison is skipped and the old behaviour stands, so ledgers
 * written before 0.4.0 keep working.
 */
export function describeRevisit(
  info: RevisitInfo | undefined,
  fpStatus: FingerprintStatus | null,
  currentRound?: number,
): RevisitDisplay | null {
  if (!info) return null;
  if (isSameRound(info.prevRound, currentRound)) return null;
  const headline = info.reason
    ? `Back for review: ${info.reason}`
    : fpStatus === "changed"
      ? "Content changed since your last review."
      : null;
  const prior = info.prevVerdict ? `Your last verdict: ${info.prevVerdict}` : null;
  const priorNote = info.prevNote ?? null;
  const notAltered = fpStatus === "unchanged" && info.prevVerdict === "reject";
  if (!headline && !prior && !notAltered) return null;
  return { headline, prior, priorNote, notAltered };
}

/**
 * True when a stored verdict belongs to the round being reviewed right now.
 * Unknown on either side = "cannot tell", which must NOT suppress the badge - a
 * missing round means a pre-0.4.0 row, and those are genuinely from earlier.
 */
export function isSameRound(prevRound?: number, currentRound?: number): boolean {
  if (typeof prevRound !== "number" || typeof currentRound !== "number") return false;
  return prevRound === currentRound;
}
