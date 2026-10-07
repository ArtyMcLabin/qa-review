// @vitest-environment jsdom
//
// 0.3.13: journey-wide verdict totals + self-saving run snapshot.
//
// Arty 2026-10-07, at the end of a ten-page journey with 12 verdicts: the panel
// said "1 approved, 0 rejected" (page-scoped, unlabeled), and the finish card
// asked him to click "Save session snapshot (optional)" - "Either save it or
// don't save it... Why did you ask me to click that button instead?"
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QAReviewOverlay } from "../src/client/QAReviewOverlay.js";
import { tallyJourney, type QAJourneyPage } from "../src/client/journey.js";
import type { QAReviewItem } from "../src/client/types.js";
import type { VerdictMap } from "../src/client/store.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGES: QAJourneyPage[] = [
  { path: "/", target: "s:/", label: "Home", itemIds: ["h1", "h2"] },
  { path: "/two", target: "s:/two", label: "Two", itemIds: ["t1"] },
  { path: "/three", target: "s:/three", label: "Three", itemIds: ["x1", "x2"] },
];

describe("tallyJourney", () => {
  it("sums declared items across every page", () => {
    const maps: Record<string, VerdictMap | null> = {
      "s:/": { h1: { verdict: "approve" }, h2: { verdict: "reject" } },
      "s:/two": { t1: { verdict: "approve" } },
      "s:/three": null, // fetch failed: counts as undecided, never throws
    };
    expect(tallyJourney(PAGES, maps)).toEqual({ approved: 2, rejected: 1, total: 5 });
  });

  it("ignores ledger rows for items no longer declared", () => {
    const maps = { "s:/two": { t1: { verdict: "approve" }, retired: { verdict: "reject" } } } as Record<
      string,
      VerdictMap
    >;
    expect(tallyJourney(PAGES, maps)).toEqual({ approved: 1, rejected: 0, total: 5 });
  });

  it("live overrides beat the fetched ledger for the current page", () => {
    const maps = { "s:/": {} } as Record<string, VerdictMap>;
    const live = { "s:/": { h1: { verdict: "reject" }, h2: { verdict: "reject" } } } as Record<
      string,
      VerdictMap
    >;
    expect(tallyJourney(PAGES, maps, live).rejected).toBe(2);
  });
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.innerHTML = "";
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe("journey finish panel", () => {
  it("shows whole-journey totals and saves the snapshot without a button", async () => {
    const LEDGERS: Record<string, VerdictMap> = {
      "s:/": {},
      "s:/two": { t1: { verdict: "approve" } },
      "s:/three": { x1: { verdict: "approve" }, x2: { verdict: "reject" } },
    };
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === "POST") {
          if (u.includes("/submit")) posts.push(u);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        const target = decodeURIComponent(u.split("target=")[1] ?? "");
        return new Response(JSON.stringify({ ok: true, verdicts: LEDGERS[target] ?? {} }), {
          status: 200,
        });
      }),
    );
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
    window.matchMedia ??= ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    for (const id of ["h1", "h2"]) {
      const el = document.createElement("section");
      el.id = id;
      el.textContent = `content ${id}`;
      document.body.appendChild(el);
    }
    const items: QAReviewItem[] = [
      { id: "h1", title: "One", selector: "#h1" },
      { id: "h2", title: "Two", selector: "#h2" },
    ];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        React.createElement(QAReviewOverlay, {
          items,
          target: "s:/",
          submitUrl: "/api/qa/submit",
          journey: { pages: PAGES },
        }),
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    const press = async (k: string) =>
      act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
        await new Promise((r) => setTimeout(r, 40));
      });
    await press("a"); // approve h1
    await press("r"); // reject h2 -> round done, every page decided -> journey complete
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

    const lines = [...document.querySelectorAll(".qar-finish-alltime")].map((e) => e.textContent ?? "");
    expect(lines.some((l) => l.includes("this page, all runs"))).toBe(true);
    const journeyLine = lines.find((l) => l.includes("whole journey")) ?? "";
    expect(journeyLine).toContain("3 approved");
    expect(journeyLine).toContain("2 rejected");
    expect(journeyLine).toContain("5 items");

    expect(posts).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Save session snapshot");
  });
});
