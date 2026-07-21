// Journey ordering / pending-count logic + task-item flow.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildJourneyNavUrl,
  countPending,
  fetchPendingCounts,
  journeyIndex,
  nextPendingPage,
  type QAJourneyPage,
} from "../src/client/journey.js";
import { isTaskItem } from "../src/client/types.js";
import { QAStore } from "../src/client/store.js";

const PAGES: QAJourneyPage[] = [
  { path: "/", target: "site:/", label: "Home", itemIds: ["a", "b", "task-1"] },
  { path: "/pricing", target: "site:/pricing", label: "Pricing", itemIds: ["p1", "p2"] },
  { path: "/about", target: "site:/about", itemIds: ["ab1"] },
  { path: "/contact", target: "site:/contact", label: "Contact", itemIds: ["c1", "c2", "c3"] },
];

describe("journeyIndex", () => {
  it("finds the page by target, -1 when absent", () => {
    expect(journeyIndex(PAGES, "site:/pricing")).toBe(1);
    expect(journeyIndex(PAGES, "site:/nope")).toBe(-1);
  });
});

describe("countPending", () => {
  it("pending = not approved (unreviewed OR rejected); empty map = all pending", () => {
    expect(countPending(["a", "b", "c"], {})).toBe(3);
    expect(countPending(["a", "b", "c"], null)).toBe(3);
    expect(
      countPending(["a", "b", "c"], {
        a: { verdict: "approve" },
        b: { verdict: "reject" }, // rejected stays pending
        c: { note: "typed but undecided" }, // note-only stays pending
      }),
    ).toBe(2);
  });
});

describe("nextPendingPage", () => {
  it("searches forward from the current page", () => {
    const counts = { "site:/": 0, "site:/pricing": 0, "site:/about": 1, "site:/contact": 2 };
    expect(nextPendingPage(PAGES, counts, 0)?.path).toBe("/about");
  });

  it("wraps around past the end (mid-journey start still covers earlier pages)", () => {
    const counts = { "site:/": 2, "site:/pricing": 0, "site:/about": 0, "site:/contact": 0 };
    expect(nextPendingPage(PAGES, counts, 2)?.path).toBe("/");
  });

  it("never returns the current page; null when the whole journey is clean", () => {
    const onlyCurrent = { "site:/": 0, "site:/pricing": 5, "site:/about": 0, "site:/contact": 0 };
    expect(nextPendingPage(PAGES, onlyCurrent, 1)).toBeNull(); // pending only HERE
    expect(nextPendingPage(PAGES, {}, 0)).toBeNull(); // all clean/unknown-zero
  });
});

describe("buildJourneyNavUrl (QA activation survives navigation)", () => {
  it("preserves gate + auth key params on the hop", () => {
    expect(buildJourneyNavUrl("/pricing", "?qa=1&key=abc123")).toBe("/pricing?qa=1&key=abc123");
  });

  it("drops the per-page target override, keeps everything else", () => {
    expect(buildJourneyNavUrl("/about", "?qa=1&key=k&target=e2e")).toBe("/about?qa=1&key=k");
  });

  it("no params -> bare path", () => {
    expect(buildJourneyNavUrl("/contact", "")).toBe("/contact");
  });
});

describe("fetchPendingCounts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("one GET per target; failed fetch counts that page as fully pending", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        urls.push(u);
        if (u.includes(encodeURIComponent("site:/pricing"))) throw new TypeError("down");
        if (u.includes(encodeURIComponent("site:/about"))) {
          return new Response(JSON.stringify({ ok: true, verdicts: { ab1: { verdict: "approve" } } }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ ok: true, verdicts: {} }), { status: 200 });
      }),
    );
    const counts = await fetchPendingCounts("/api/qa/state", PAGES);
    expect(urls).toHaveLength(PAGES.length);
    expect(counts["site:/"]).toBe(3); // empty ledger = all pending
    expect(counts["site:/pricing"]).toBe(2); // fetch failed = assume pending
    expect(counts["site:/about"]).toBe(0); // approved = clean
    expect(counts["site:/contact"]).toBe(3);
  });
});

describe("task items (off-DOM)", () => {
  it("isTaskItem discriminates on missing selector", () => {
    expect(isTaskItem({ selector: undefined })).toBe(true);
    expect(isTaskItem({})).toBe(true);
    expect(isTaskItem({ selector: '[data-qa="hero"]' })).toBe(false);
  });

  it("task items count as pending until approved, like any item", () => {
    expect(countPending(["task-1"], {})).toBe(1);
    expect(countPending(["task-1"], { "task-1": { verdict: "approve" } })).toBe(0);
  });

  it("task-item verdict flow: approve + note persists in REAL TIME, undo deletes", async () => {
    const m = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
      },
    } as unknown as Window);
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") calls.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const s = new QAStore({ target: "site:/" });
    // The overlay's record() path for a task item (id "sso-check"-style):
    s.persist("task-1", { verdict: "approve", note: "works" });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([{ target: "site:/", itemId: "task-1", verdict: "approve", note: "works" }]);
    expect(s.load()["task-1"]).toEqual({ verdict: "approve", note: "works" });

    // Undo -> immediate single-item invalidation:
    s.remove("task-1");
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[1]).toEqual({ target: "site:/", itemId: "task-1", verdict: null });
    expect(s.load()["task-1"]).toBeUndefined();
  });
});
