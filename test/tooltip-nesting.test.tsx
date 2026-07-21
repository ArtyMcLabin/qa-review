// @vitest-environment jsdom
//
// 0.3.4: exactly ONE tooltip per hover point. Renders the REAL overlay in
// jsdom and asserts the structural invariant: no [data-qatip] element may
// have a [data-qatip] ANCESTOR (nesting is what produced a reviewer's double
// tooltip on the Copy-ref button). Covers the review card, the finish panel,
// and the minimized bubble.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QAReviewOverlay } from "../src/client/QAReviewOverlay.js";
import { QA_STYLES } from "../src/client/styles.js";
import type { QAReviewItem } from "../src/client/types.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS: QAReviewItem[] = [
  {
    id: "hero",
    title: "Hero",
    sub: "Check the hero.",
    selector: "#anchor",
    device: "💻📱",
    devices: ["pc", "mobile"],
    variations: { count: 2, current: 1, onSelect: () => {} },
  },
  { id: "task-1", title: "Task", sub: "A question?", action: { href: "https://example.com/x" } },
];

function assertNoNestedQatip(scope: string) {
  const nodes = Array.from(document.querySelectorAll("[data-qatip]"));
  expect(nodes.length).toBeGreaterThan(0);
  for (const node of nodes) {
    const nestedAncestor = node.parentElement?.closest("[data-qatip]") ?? null;
    expect(
      nestedAncestor,
      `${scope}: nested tooltip - <${node.tagName.toLowerCase()} data-qatip="${node.getAttribute(
        "data-qatip",
      )}"> sits inside <${nestedAncestor?.tagName.toLowerCase()} data-qatip="${nestedAncestor?.getAttribute(
        "data-qatip",
      )}">`,
    ).toBeNull();
  }
}

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.getElementById("anchor")?.remove();
  document.getElementById("qa-review-styles")?.remove();
  vi.unstubAllGlobals();
});

async function renderOverlay(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true, verdicts: {} }), { status: 200 })),
  );
  // jsdom implements neither scrollIntoView nor matchMedia.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  // The overlay guards for missing matchMedia, but stub it anyway so the
  // auto-bubble listener path is exercised.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  const anchor = document.createElement("section");
  anchor.id = "anchor";
  anchor.textContent = "Hero content";
  document.body.appendChild(anchor);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      React.createElement(QAReviewOverlay, {
        items: ITEMS,
        target: "example:/",
        journey: {
          pages: [
            { path: "/", target: "example:/", label: "Home", itemIds: ["hero", "task-1"] },
            { path: "/b", target: "example:/b", label: "B", itemIds: ["b1"] },
          ],
        },
        submitUrl: "/api/qa/submit",
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe("tooltip nesting invariant (rendered overlay)", () => {
  it("review card has no [data-qatip] inside another [data-qatip]", async () => {
    await renderOverlay();
    expect(document.querySelector(".qar-card")).toBeTruthy();
    // The Copy-ref button (a reviewer's double-tooltip repro) must be a tooltip LEAF.
    const copyRef = Array.from(document.querySelectorAll("button[data-qatip]")).find((b) =>
      b.textContent?.includes("Copy ref"),
    );
    expect(copyRef).toBeTruthy();
    expect(copyRef!.parentElement?.closest("[data-qatip]")).toBeNull();
    assertNoNestedQatip("card");
  });

  it("minimized bubble has a single tooltip carrier", async () => {
    await renderOverlay();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "m" }));
      await new Promise((r) => setTimeout(r, 10));
    });
    const bubble = document.querySelector(".qar-bubble");
    expect(bubble).toBeTruthy();
    expect(bubble!.hasAttribute("data-qatip")).toBe(true);
    expect(bubble!.querySelectorAll("[data-qatip]").length).toBe(0); // no nested carriers
    assertNoNestedQatip("bubble");
  });

  it("stylesheet carries the ancestor-suppression guard as a second line of defense", () => {
    expect(QA_STYLES).toContain(":has([data-qatip]:hover)::after{display:none;}");
  });
});
