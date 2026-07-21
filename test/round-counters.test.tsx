// @vitest-environment jsdom
//
// 0.3.5 #3: the finish panel must show THIS ROUND's counts (verdicts recorded
// in this run), with ledger totals demoted to a clearly-labeled "all-time"
// line - a reviewer saw "39 approved" from history and could not tell what they had
// actually done in the session.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QAReviewOverlay } from "../src/client/QAReviewOverlay.js";
import type { QAReviewItem } from "../src/client/types.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS: QAReviewItem[] = [
  { id: "a", title: "A", selector: "#a" }, // approved in a PRIOR run (ledger)
  { id: "b", title: "B", selector: "#b" },
  { id: "c", title: "C", selector: "#c" },
  { id: "d", title: "D", selector: "#d" }, // rejected in a PRIOR run -> in round
];

/** Ledger from previous runs: 1 approve + 1 reject. */
const LEDGER = {
  a: { verdict: "approve" },
  d: { verdict: "reject", note: "old note" },
};

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll("section[data-fix]").forEach((n) => n.remove());
  document.getElementById("qa-review-styles")?.remove();
  vi.unstubAllGlobals();
});

async function key(k: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe("round-scoped counters", () => {
  it("finish panel: this-round counts primary, ledger totals as labeled all-time line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.method === "POST" ? {} : { ok: true, verdicts: LEDGER };
        return new Response(JSON.stringify({ ok: true, ...body }), { status: 200 });
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
    for (const id of ["a", "b", "c", "d"]) {
      const el = document.createElement("section");
      el.id = id;
      el.setAttribute("data-fix", "1");
      el.textContent = `content ${id}`;
      document.body.appendChild(el);
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(React.createElement(QAReviewOverlay, { items: ITEMS, target: "example:/" }));
      await new Promise((r) => setTimeout(r, 40));
    });

    // Round = b, c, d (a is ledger-approved; d ledger-rejected stays in round).
    expect(document.querySelector(".qar-counter")?.textContent).toContain("1 of 3");

    await key("a"); // approve b
    await key("r"); // reject c
    await key("a"); // approve d (was rejected in a prior run)

    const stats = document.querySelector(".qar-finish-stats")?.textContent ?? "";
    const alltime = document.querySelector(".qar-finish-alltime")?.textContent ?? "";
    // THIS ROUND: exactly what they did in this run.
    expect(stats).toContain("2 approved");
    expect(stats).toContain("1 rejected");
    expect(stats).toContain("this round");
    // ALL-TIME (ledger): prior approve of "a" included, "d" now approved.
    expect(alltime).toContain("all-time");
    expect(alltime).toContain("3 approved");
    expect(alltime).toContain("1 rejected");
    expect(alltime).toContain("4 items");
  });
});
