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
 * element's textContent; off-DOM task items hash their question text (sub,
 * falling back to title). Returns null when the anchor is not present (e.g.
 * other-viewport element) - no judgement is made then.
 *
 * 🚨 textContent, NEVER innerText (Arty 2026-09-24, GameReady fundraise FAQ).
 * innerText is spec'd to approximate what a user currently SEES, so it
 * excludes anything not laid out - which includes the body of a closed
 * native `<details>`. Every accordion-style FAQ defaults to collapsed, so an
 * anchor on the answer paragraph inside it fingerprinted ONLY the always-
 * visible summary/question text forever, regardless of how the answer was
 * edited. "NOT ALTERED since your rejection" then showed on an item that
 * had, in fact, been fixed the same day it was rejected - the exact
 * regression this poka-yoke exists to prevent, silently defeated by the one
 * DOM shape (collapsed accordion) FAQ content overwhelmingly uses. textContent
 * does not care about layout/visibility, which is what "did the words
 * change" actually needs - this was invisible in tests because jsdom does
 * not implement `<details>` collapse or innerText's visibility semantics at
 * all, so the bug could only ever surface against a real rendered page.
 */
export function itemFingerprint(item: QAReviewItem, doc: Document): string | null {
  if (!item.selector) return fingerprintText(item.sub ?? item.title);
  const el = doc.querySelector<HTMLElement>(item.selector);
  if (!el) return null;
  return fingerprintText(el.textContent ?? "");
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
