// 0.3.2 regression: the journey must NEVER ping-pong back to a page whose
// remaining non-approved items were already REJECTED this run. Exact live
// repro: page 1 reviewed with rejects -> auto-nav to page 2 -> page 2 done ->
// auto-nav went BACK to page 1 and re-presented the fresh rejects, forever.
// Fix: navigation-pending = UNVERDICTED items only (no verdict AND no device
// approvals); rejected/partial items are handled-this-run. Round semantics
// (rejects re-present in FUTURE rounds) are unchanged - covered at the end.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countPending,
  countUnverdicted,
  fetchPendingCounts,
  nextPendingPage,
  resolveFinishAction,
  type QAJourneyPage,
} from "../src/client/journey.js";
import type { VerdictMap } from "../src/client/store.js";

const PAGES: QAJourneyPage[] = [
  { path: "/", target: "s:/", label: "Page 1", itemIds: ["a1", "a2", "a3"] },
  { path: "/two", target: "s:/two", label: "Page 2", itemIds: ["b1", "b2"] },
  { path: "/three", target: "s:/three", label: "Page 3", itemIds: ["c1", "c2"] },
  { path: "/four", target: "s:/four", label: "Page 4", itemIds: ["d1"] },
];

/** Ledgers after a reviewer reviewed page 1 (one approve, TWO rejects) + page 2. */
const LEDGERS: Record<string, VerdictMap> = {
  "s:/": {
    a1: { verdict: "approve" },
    a2: { verdict: "reject", note: "fix the copy" },
    a3: { verdict: "reject" },
  },
  "s:/two": { b1: { verdict: "approve" }, b2: { verdict: "reject" } },
  "s:/three": {}, // untouched
  "s:/four": {}, // untouched
};

const countsFrom = (ledgers: Record<string, VerdictMap>) =>
  Object.fromEntries(PAGES.map((p) => [p.target, countUnverdicted(p.itemIds, ledgers[p.target])]));

describe("countUnverdicted (navigation semantics)", () => {
  it("rejects and partial device approvals count as HANDLED; only untouched items are pending", () => {
    expect(countUnverdicted(["a1", "a2", "a3"], LEDGERS["s:/"])).toBe(0); // approve+2 rejects = handled
    expect(
      countUnverdicted(["x", "y", "z"], {
        x: { verdict: "reject" },
        y: { approvedDevices: ["pc"] }, // partial device state = handled
        z: { note: "note-only, no verdict" }, // note alone = NOT handled
      }),
    ).toBe(1);
    expect(countUnverdicted(["x"], {})).toBe(1);
  });
});

describe("the exact ping-pong repro", () => {
  it("finishing page 2 navigates to page 3 - NOT back to rejected page 1", () => {
    const counts = countsFrom(LEDGERS);
    expect(counts["s:/"]).toBe(0); // page 1 fully handled this run despite rejects
    const action = resolveFinishAction(PAGES, counts, 1 /* on page 2 */);
    expect(action).toEqual({ kind: "navigate", page: PAGES[2] });
  });

  it("wraparound only returns to pages with UNVERDICTED items", () => {
    // From page 4, page 1 holds only verdicts, page 3 still untouched -> wrap to page 3.
    const counts = countsFrom(LEDGERS);
    expect(nextPendingPage(PAGES, counts, 3)?.path).toBe("/three");
    // A genuinely untouched earlier page IS still reachable via wraparound.
    const withUntouchedFirst = countsFrom({ ...LEDGERS, "s:/": {} });
    expect(nextPendingPage(PAGES, withUntouchedFirst, 2)?.path).toBe("/four");
    expect(nextPendingPage(PAGES, { ...withUntouchedFirst, "s:/four": 0 }, 2)?.path).toBe("/");
  });

  it("journey-complete when every page has zero unverdicted items (rejects everywhere)", () => {
    const allHandled: Record<string, VerdictMap> = {
      "s:/": LEDGERS["s:/"],
      "s:/two": LEDGERS["s:/two"],
      "s:/three": { c1: { verdict: "reject" }, c2: { verdict: "approve" } },
      "s:/four": { d1: { approvedDevices: ["pc"] } },
    };
    expect(resolveFinishAction(PAGES, countsFrom(allHandled), 3)).toEqual({
      kind: "journey-complete",
    });
  });

  it("fetchPendingCounts applies navigation semantics to the fetched ledgers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const target = decodeURIComponent(String(url).split("target=")[1]);
        return new Response(JSON.stringify({ ok: true, verdicts: LEDGERS[target] ?? {} }), {
          status: 200,
        });
      }),
    );
    const counts = await fetchPendingCounts("/api/qa/state", PAGES);
    expect(counts).toEqual({ "s:/": 0, "s:/two": 0, "s:/three": 2, "s:/four": 1 });
  });

  afterEach(() => vi.unstubAllGlobals());
});

describe("round semantics unchanged (ledger, future runs)", () => {
  it("rejected items STAY round-pending for the next round", () => {
    // The in-page round freeze uses not-approved semantics - the two rejects
    // on page 1 re-present next time that page is reviewed.
    expect(countPending(["a1", "a2", "a3"], LEDGERS["s:/"])).toBe(2);
  });
});
