// @vitest-environment jsdom
//
// 0.3.8, both from Arty's 2026-08-09 feedback on the Galaxy Munch board:
//
//  1. "Clicking on 'Back to review' in the QA interactive panel should go to the
//     last item and not to the first item. (as if it was undo instead of
//     restart)". You press it having just finished, because of something about
//     the item you just judged; landing on item 1 of N makes it a restart.
//
//  2. "should have right click option on 'copy ref' button, to include an
//     'append to current clipboard'. Which should pretty much let us collect
//     multiple references together to be able to paste them all in one."
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QAReviewOverlay } from "../src/client/QAReviewOverlay.js";
import type { QAReviewItem } from "../src/client/types.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS: QAReviewItem[] = [
  { id: "a", title: "A", selector: "#a" },
  { id: "b", title: "B", selector: "#b" },
  { id: "c", title: "C", selector: "#c" },
];

let root: Root | null = null;
let host: HTMLElement | null = null;
let written: string[] = [];

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll("section[data-fix]").forEach((n) => n.remove());
  document.getElementById("qa-review-styles")?.remove();
  vi.unstubAllGlobals();
  written = [];
});

async function key(k: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

async function click(el: Element, type: "click" | "contextmenu" = "click"): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

async function mount(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true, verdicts: {} }), { status: 200 })),
  );
  written = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (t: string) => {
        written.push(t);
        return Promise.resolve();
      },
    },
  });
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
  for (const id of ["a", "b", "c"]) {
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
}

/** By POSITION, not by label: the label changes to "Copied!" while it flashes. */
const refButton = () => document.querySelector(".qar-ref-row .qar-pick-btn") as HTMLButtonElement;

const backButton = () =>
  Array.from(document.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === "Back to review",
  )!;

describe("0.3.8 - Back to review is an undo, not a restart", () => {
  it("🚨 lands on the LAST item of the round, not the first", async () => {
    await mount();
    expect(document.querySelector(".qar-counter")?.textContent).toContain("1 of 3");
    await key("a");
    await key("a");
    await key("a"); // finished
    expect(backButton()).toBeTruthy();

    await click(backButton());
    // 3 of 3 - the item they had just judged, not item 1.
    expect(document.querySelector(".qar-counter")?.textContent).toContain("3 of 3");
  });
});

describe("0.3.8 - collecting several references for one paste", () => {
  it("plain click copies exactly this item's reference line", async () => {
    await mount();
    await click(refButton());
    expect(written.length).toBe(1);
    expect(written[0]).toContain("qa-ref:");
    expect(written[0]).toContain("# a");
    expect(written[0].split("\n").length).toBe(1);
  });

  it("🚨 right-click ADDS to the collection, and the clipboard carries them all", async () => {
    await mount();
    await click(refButton(), "contextmenu"); // item a
    await key("a"); // approve -> advance to b
    await click(refButton(), "contextmenu"); // item b

    const last = written[written.length - 1];
    const lines = last.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("# a");
    expect(lines[1]).toContain("# b");
  });

  it("says how many are collected, so the count is not held in the operator's head", async () => {
    await mount();
    await click(refButton(), "contextmenu");
    await key("a");
    await click(refButton(), "contextmenu");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600)); // let the "Copied!" flash clear
    });
    expect(refButton().textContent).toContain("2 collected");
  });

  it("🚨 right-clicking the same item twice does not duplicate it - that is a slip, not a request", async () => {
    await mount();
    await click(refButton(), "contextmenu");
    await click(refButton(), "contextmenu");
    const last = written[written.length - 1];
    expect(last.split("\n").length).toBe(1);
  });

  it("a plain click ENDS the collection, so there is a way out of a half-built list", async () => {
    await mount();
    await click(refButton(), "contextmenu");
    await key("a");
    await click(refButton(), "contextmenu");
    await click(refButton()); // plain click: replace
    expect(written[written.length - 1].split("\n").length).toBe(1);

    await key("a");
    await click(refButton(), "contextmenu");
    // Collection restarted from empty rather than resuming at 3.
    expect(written[written.length - 1].split("\n").length).toBe(1);
  });

  it("🚨 never reads the clipboard - it can only ever append refs it produced itself", async () => {
    await mount();
    // A readText that would throw if called. Appending to "whatever is on the
    // clipboard" would also append passwords and pasted pastas; the buffer lives
    // in the panel precisely so that cannot happen.
    const readText = vi.fn(() => {
      throw new Error("clipboard read must never be attempted");
    });
    Object.defineProperty(navigator.clipboard, "readText", { configurable: true, value: readText });
    await click(refButton(), "contextmenu");
    expect(readText).not.toHaveBeenCalled();
  });
});
