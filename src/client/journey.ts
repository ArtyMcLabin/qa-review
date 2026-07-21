// Cross-page journey support: pure helpers (unit-tested) used by the overlay
// to compute per-page pending counts from the durable ledger, pick the next
// page that still needs review, and build navigation URLs that PRESERVE the
// QA activation params (gate param, auth key, etc.) across a full page load.

import type { VerdictMap } from "./store.js";

export interface QAJourneyPage {
  /** Pathname to navigate to (e.g. "/pricing"). */
  path: string;
  /** Ledger bucket for that page (e.g. "example-site:/pricing"). */
  target: string;
  /** Human label for the journey summary. Default: path. */
  label?: string;
  /** ALL reviewable item ids on that page (pending = not approved in ledger). */
  itemIds: string[];
}

export interface QAJourneyConfig {
  /** Ordered pages of the review journey. */
  pages: QAJourneyPage[];
}

/** Index of the journey page whose target matches, or -1. */
export function journeyIndex(pages: readonly QAJourneyPage[], target: string): number {
  return pages.findIndex((p) => p.target === target);
}

/**
 * ROUND-pending = items NOT approved in the ledger map (unreviewed OR
 * rejected) - the overlay's round-freeze rule: rejected items re-present in
 * FUTURE rounds. An empty/missing map counts every item as pending.
 */
export function countPending(itemIds: readonly string[], map: VerdictMap | null | undefined): number {
  return itemIds.filter((id) => map?.[id]?.verdict !== "approve").length;
}

/**
 * NAVIGATION-pending (0.3.2 fix) = items the reviewer has not TOUCHED yet:
 * no verdict AND no device approvals recorded. Approve, reject, AND partial
 * device states all count as HANDLED for the current run's navigation -
 * 🚨 counting fresh REJECTS as pending made the journey ping-pong forever
 * between a rejected page and the next one (wraparound kept returning to the
 * rejects). Rejected items still re-enter FUTURE rounds via countPending /
 * the round freeze - they just never re-enter THIS run's walkthrough.
 */
export function countUnverdicted(
  itemIds: readonly string[],
  map: VerdictMap | null | undefined,
): number {
  return itemIds.filter((id) => {
    const e = map?.[id];
    return !e?.verdict && !e?.approvedDevices?.length;
  }).length;
}

/**
 * Next journey page (excluding the current one) with pending items: searches
 * FORWARD from the current page and wraps around, so a mid-journey start still
 * covers earlier pages. Returns null when the whole journey is clean. Feed it
 * NAVIGATION-pending counts (countUnverdicted) - never round counts, or pages
 * with fresh rejects bounce the walkthrough back forever.
 */
export function nextPendingPage(
  pages: readonly QAJourneyPage[],
  pendingByTarget: Readonly<Record<string, number>>,
  currentIndex: number,
): QAJourneyPage | null {
  for (let step = 1; step < pages.length; step++) {
    const p = pages[(currentIndex + step + pages.length) % pages.length];
    if ((pendingByTarget[p.target] ?? 0) > 0) return p;
  }
  return null;
}

/**
 * What the finished-state UI shows in a journey (0.3.1): an UNMISTAKABLE
 * loading indicator from the moment the round exhausts until the next page
 * unloads this one - never a blank screen (a reviewer almost exited thinking the
 * review was done) - or the journey-complete panel.
 */
export function journeyFinishView(
  inJourney: boolean,
  journeyComplete: boolean,
): "standard" | "loading" | "complete" {
  if (!inJourney) return "standard";
  return journeyComplete ? "complete" : "loading";
}

export type FinishAction =
  | { kind: "navigate"; page: QAJourneyPage }
  | { kind: "journey-complete" };

/**
 * What happens the moment a page's round is exhausted: navigate IMMEDIATELY
 * to the next page with pending items (no interstitial, no success popup), or
 * show the journey-complete panel when nothing is pending anywhere.
 */
export function resolveFinishAction(
  pages: readonly QAJourneyPage[],
  pendingByTarget: Readonly<Record<string, number>>,
  currentIndex: number,
): FinishAction {
  const page = nextPendingPage(pages, pendingByTarget, currentIndex);
  return page ? { kind: "navigate", page } : { kind: "journey-complete" };
}

/**
 * Build the navigation URL for a journey hop, preserving the current page's
 * query params (QA gate param, auth key, ...) so activation survives the full
 * page load. The per-page `target` override is dropped - the arriving page
 * derives its own bucket.
 */
export function buildJourneyNavUrl(path: string, currentSearch: string): string {
  const params = new URLSearchParams(currentSearch);
  params.delete("target");
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Fetch the ledger for every journey page (one state GET per target) and
 * return NAVIGATION-pending counts (unverdicted items - see countUnverdicted;
 * rejected/partial items are handled-this-run and must not re-attract
 * navigation). A failed fetch counts that page's items as pending (never lose
 * a page silently).
 */
export async function fetchPendingCounts(
  stateUrl: string,
  pages: readonly QAJourneyPage[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    pages.map(async (p) => {
      let map: VerdictMap | null = null;
      try {
        const r = await fetch(`${stateUrl}?target=${encodeURIComponent(p.target)}`, {
          cache: "no-store",
        });
        if (r.ok) {
          const d = (await r.json()) as { ok?: boolean; verdicts?: VerdictMap };
          if (d?.ok && d.verdicts) map = d.verdicts;
        }
      } catch {
        map = null;
      }
      out[p.target] = countUnverdicted(p.itemIds, map);
    }),
  );
  return out;
}
