// @vitest-environment jsdom
//
// 0.3.6: live mobile-preview variant propagation + bubble docks LEFT.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  PREVIEW_MESSAGE_TYPE,
  parseVariantMessage,
  postVariantToPreview,
  type VariantMessage,
} from "../src/client/preview.js";
import { QAReviewOverlay } from "../src/client/QAReviewOverlay.js";
import type { QAReviewItem } from "../src/client/types.js";

/* ------------------- 1. live variant message protocol ---------------------- */

describe("preview variant message protocol", () => {
  it("parseVariantMessage accepts only well-formed variant messages", () => {
    expect(parseVariantMessage({ type: PREVIEW_MESSAGE_TYPE, itemId: "hero", variant: 3 })).toEqual({
      type: PREVIEW_MESSAGE_TYPE,
      itemId: "hero",
      variant: 3,
    });
    expect(parseVariantMessage({ type: "other", itemId: "hero", variant: 3 })).toBeNull();
    expect(parseVariantMessage({ type: PREVIEW_MESSAGE_TYPE, itemId: "hero" })).toBeNull();
    expect(parseVariantMessage(null)).toBeNull();
    expect(parseVariantMessage("nope")).toBeNull();
  });

  it("postVariantToPreview posts a same-origin message to the iframe window", () => {
    const posted: Array<{ msg: unknown; origin: string }> = [];
    const iframe = {
      contentWindow: { postMessage: (msg: unknown, origin: string) => posted.push({ msg, origin }) },
    } as unknown as HTMLIFrameElement;
    postVariantToPreview(iframe, "hero", 2);
    expect(posted).toHaveLength(1);
    expect(posted[0].msg).toEqual({ type: PREVIEW_MESSAGE_TYPE, itemId: "hero", variant: 2 });
    expect(posted[0].origin).toBe(window.location.origin);
  });

  it("postVariantToPreview no-ops when there is no iframe window", () => {
    expect(() => postVariantToPreview(null, "hero", 1)).not.toThrow();
    expect(() =>
      postVariantToPreview({ contentWindow: null } as unknown as HTMLIFrameElement, "hero", 1),
    ).not.toThrow();
  });
});

/* --------- embedded overlay applies incoming variant in ITS document -------- */

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.getElementById("qa-review-styles")?.remove();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("embedded overlay applies variant messages in its own document", () => {
  it("runs the item's onSelect when it receives a same-origin variant message", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, verdicts: {} }), { status: 200 })),
    );
    // Mark THIS document as the embedded preview (overlay stays dormant, but
    // the message listener is active).
    window.history.replaceState({}, "", "/?qaMobilePreview=1");

    const applied: number[] = [];
    const items: QAReviewItem[] = [
      {
        id: "hero",
        title: "Hero",
        selector: "#hero",
        variations: { count: 3, current: 1, onSelect: (v) => applied.push(v) },
      },
    ];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(React.createElement(QAReviewOverlay, { items, target: "example:/" }));
      await new Promise((r) => setTimeout(r, 20));
    });
    // Dormant: no chrome rendered inside the preview iframe.
    expect(document.querySelector(".qar-card")).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: PREVIEW_MESSAGE_TYPE, itemId: "hero", variant: 2 } as VariantMessage,
          origin: window.location.origin,
        }),
      );
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(applied).toEqual([2]); // the variation mutation ran in THIS document

    // Cross-origin messages are ignored.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: PREVIEW_MESSAGE_TYPE, itemId: "hero", variant: 3 },
          origin: "https://evil.example",
        }),
      );
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(applied).toEqual([2]); // unchanged
  });
});

/* --------------------------- 2. bubble docks left -------------------------- */

describe("minimize bubble docks LEFT by default", () => {
  it("bubble default style uses left, not right", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, verdicts: {} }), { status: 200 })),
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
    const anchor = document.createElement("section");
    anchor.id = "hero";
    anchor.textContent = "Hero";
    document.body.appendChild(anchor);
    const items: QAReviewItem[] = [{ id: "hero", title: "Hero", selector: "#hero" }];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(React.createElement(QAReviewOverlay, { items, target: "example:/" }));
      await new Promise((r) => setTimeout(r, 30));
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "m" }));
      await new Promise((r) => setTimeout(r, 10));
    });
    const bubble = document.querySelector(".qar-bubble") as HTMLElement | null;
    expect(bubble).toBeTruthy();
    expect(bubble!.style.left).toBe("24px");
    expect(bubble!.style.right).toBe(""); // not docked right
    anchor.remove();
  });
});
