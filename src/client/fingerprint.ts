"use client";

// NOT-ALTERED poka-yoke: a content fingerprint is stored with every verdict.
// When a previously-REJECTED item comes up again and the page content still
// fingerprints the same, the card shows a SYSTEM-COMPUTED "NOT ALTERED since
// your rejection" badge - judged by hashing, never by the operating agent, so
// the reviewer instantly sees nothing was worked on. A differing fingerprint
// shows a subtle "changed since last review" hint instead.

import { fnv1a } from "../shared/codename.js";
import type { QAReviewItem } from "./types.js";

/** Collapse all whitespace runs so formatting-only DOM churn doesn't count. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Deterministic fingerprint of a text blob (normalized FNV-1a, hex). */
export function fingerprintText(text: string): string {
  return fnv1a(normalizeText(text)).toString(16).padStart(8, "0");
}

/**
 * Fingerprint the CURRENT content of an item: anchored items hash the
 * element's rendered innerText; off-DOM task items hash their question text
 * (sub, falling back to title). Returns null when the anchor is not present
 * (e.g. other-viewport element) - no judgement is made then.
 */
export function itemFingerprint(item: QAReviewItem, doc: Document): string | null {
  if (!item.selector) return fingerprintText(item.sub ?? item.title);
  const el = doc.querySelector<HTMLElement>(item.selector);
  if (!el) return null;
  return fingerprintText(el.innerText ?? el.textContent ?? "");
}

export type FingerprintStatus = "unchanged" | "changed";

/**
 * Compare the fingerprint STORED with the last verdict against the current
 * one. Null when either side is unknown (no stored fp / anchor missing) - the
 * badge only ever asserts what the system actually measured.
 */
export function fingerprintStatus(
  stored: string | null | undefined,
  current: string | null | undefined,
): FingerprintStatus | null {
  if (!stored || !current) return null;
  return stored === current ? "unchanged" : "changed";
}
