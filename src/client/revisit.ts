"use client";

// Re-queue context (0.3.3): when an item is invalidated back into review, the
// card must answer "why am I seeing this again and what changed?" - a reviewer
// paused a review over exactly this gap. The invalidation API carries an
// optional `revisitReason`; the row keeps their prior verdict + note; and the
// fingerprint tells whether the content actually changed since that verdict.

import type { FingerprintStatus } from "./fingerprint.js";

export interface RevisitInfo {
  /** Why the item was re-queued (set by the invalidation call). */
  reason?: string;
  /** The reviewer's verdict before invalidation. */
  prevVerdict?: string;
  /** The reviewer's note from that prior verdict. */
  prevNote?: string;
}

export interface RevisitDisplay {
  /** Prominent "Back for review: ..." headline (reason, or generic change note). */
  headline: string | null;
  /** "Your last verdict: reject - "note"" context line. */
  prior: string | null;
  /** Show the prominent NOT-ALTERED badge (prior REJECT + identical content). */
  notAltered: boolean;
}

/**
 * Pure display logic for a re-queued item. Rules:
 * - a provided reason headlines as "Back for review: <reason>";
 * - no reason but a CHANGED fingerprint -> generic "Content changed since
 *   your last review.";
 * - a prior verdict renders as context ("Your last verdict: ...") with the
 *   saved note;
 * - prior REJECT + UNCHANGED fingerprint keeps the system-computed
 *   NOT-ALTERED badge (reason or not - the reviewer must see nothing moved).
 */
export function describeRevisit(
  info: RevisitInfo | undefined,
  fpStatus: FingerprintStatus | null,
): RevisitDisplay | null {
  if (!info) return null;
  const headline = info.reason
    ? `Back for review: ${info.reason}`
    : fpStatus === "changed"
      ? "Content changed since your last review."
      : null;
  const prior = info.prevVerdict
    ? `Your last verdict: ${info.prevVerdict}${info.prevNote ? ` - "${info.prevNote}"` : ""}`
    : null;
  const notAltered = fpStatus === "unchanged" && info.prevVerdict === "reject";
  if (!headline && !prior && !notAltered) return null;
  return { headline, prior, notAltered };
}
