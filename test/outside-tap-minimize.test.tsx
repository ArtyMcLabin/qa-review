// @vitest-environment jsdom
//
// 0.3.10: pixel-hunting for the small minimize button is real friction on a
// phone. A pointerdown outside the card should minimize it too, but ONLY at
// mobile width - a stray outside click on desktop must NOT collapse the
// panel, and a pointerdown that starts INSIDE the card (e.g. dragging the
// header) must not trigger it either.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QAReviewOverlay } from "../src/client/QAReviewOverlay.js";
import type { QAReviewItem } from "../src/client/types.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS: QAReviewItem[] = [{ id: "a", title: "A", selector: "#a" }];

let root: Root | null = null;
let host: HTMLElement | null = null;
let matches = false;

function stubMatchMedia(): void {
  window.matchMedia = ((q: string) => ({
    matches,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll("section[data-fix]").forEach((n) => n.remove());
  document.getElementById("qa-review-styles")?.remove();
  vi.unstubAllGlobals();
  matches = false;
});

async function renderOverlay(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.method === "POST" ? {} : { ok: true, verdicts: {} };
      return new Response(JSON.stringify({ ok: true, ...body }), { status: 200 });
    }),
  );
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  stubMatchMedia();
  const el = document.createElement("section");
  el.id = "a";
  el.setAttribute("data-fix", "1");
  el.textContent = "content a";
  document.body.appendChild(el);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(QAReviewOverlay, { items: ITEMS, target: "example:/" }));
    await new Promise((r) => setTimeout(r, 40));
  });
}

function pointerDownOn(el: Element): void {
  el.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
}

describe("outside tap to minimize (mobile only)", () => {
  it("minimizes on an outside tap at mobile width", async () => {
    await renderOverlay();
    expect(document.querySelector(".qar-card")).toBeTruthy();

    matches = true; // simulate mobile-width viewport
    await act(async () => {
      pointerDownOn(document.body);
    });

    expect(document.querySelector(".qar-card")).toBeFalsy();
    expect(document.querySelector(".qar-bubble")).toBeTruthy();
  });

  it("does NOT minimize on an outside tap at desktop width", async () => {
    await renderOverlay();
    matches = false; // desktop width

    await act(async () => {
      pointerDownOn(document.body);
    });

    expect(document.querySelector(".qar-card")).toBeTruthy();
    expect(document.querySelector(".qar-bubble")).toBeFalsy();
  });

  it("does NOT minimize on a pointerdown that starts inside the card", async () => {
    await renderOverlay();
    matches = true; // mobile width

    const card = document.querySelector(".qar-card");
    expect(card).toBeTruthy();
    await act(async () => {
      pointerDownOn(card!);
    });

    expect(document.querySelector(".qar-card")).toBeTruthy();
    expect(document.querySelector(".qar-bubble")).toBeFalsy();
  });
});
