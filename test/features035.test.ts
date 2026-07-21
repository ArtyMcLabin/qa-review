// @vitest-environment jsdom
//
// 0.3.5: journey preload (prefetch near round end, instant hop on cached
// counts), mobile preview URL/embed helpers, and prefetch-link warming.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensurePrefetchLink,
  isPrefetchFresh,
  shouldPrefetch,
  PREFETCH_MAX_AGE_MS,
  PREFETCH_WINDOW_ITEMS,
} from "../src/client/journey.js";
import {
  buildMobilePreviewUrl,
  isEmbeddedPreview,
  MOBILE_PREVIEW_HEIGHT,
  MOBILE_PREVIEW_WIDTH,
  PREVIEW_MARKER_PARAM,
} from "../src/client/preview.js";
import { QA_STYLES } from "../src/client/styles.js";

afterEach(() => {
  document.querySelectorAll('link[data-qar-prefetch="1"]').forEach((l) => l.remove());
  vi.unstubAllGlobals();
});

/* ------------------------------ 1. preload -------------------------------- */

describe("journey preload", () => {
  it("prefetch starts within the final N items of the round", () => {
    expect(PREFETCH_WINDOW_ITEMS).toBe(2);
    expect(shouldPrefetch(0, 10)).toBe(false); // 10 left
    expect(shouldPrefetch(7, 10)).toBe(false); // 3 left
    expect(shouldPrefetch(8, 10)).toBe(true); // 2 left
    expect(shouldPrefetch(9, 10)).toBe(true); // last item
    expect(shouldPrefetch(0, 1)).toBe(true); // single-item round
    expect(shouldPrefetch(0, 0)).toBe(false); // empty round: nothing to prefetch
  });

  it("cached counts are used only while fresh", () => {
    const t0 = 1_000_000;
    expect(isPrefetchFresh(t0, t0 + PREFETCH_MAX_AGE_MS - 1)).toBe(true);
    expect(isPrefetchFresh(t0, t0 + PREFETCH_MAX_AGE_MS)).toBe(false); // stale -> on-demand fetch
    expect(isPrefetchFresh(t0, t0 - 5)).toBe(false); // clock skew: treat as stale
  });

  it("ensurePrefetchLink warms the next page idempotently", () => {
    ensurePrefetchLink(document, "/next?qa=1&key=k");
    ensurePrefetchLink(document, "/next?qa=1&key=k"); // duplicate -> no second link
    ensurePrefetchLink(document, "/other?qa=1");
    const links = Array.from(document.querySelectorAll('link[data-qar-prefetch="1"]'));
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/next?qa=1&key=k", "/other?qa=1"]);
    expect(links.every((l) => (l as HTMLLinkElement).rel === "prefetch")).toBe(true);
  });
});

/* ---------------------------- 2. mobile preview ---------------------------- */

describe("mobile preview helpers", () => {
  it("preview URL keeps the QA activation params and adds the embed marker", () => {
    const url = buildMobilePreviewUrl("https://example.com/pricing?qa=1&key=abc");
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/pricing");
    expect(parsed.searchParams.get("qa")).toBe("1");
    expect(parsed.searchParams.get("key")).toBe("abc");
    expect(parsed.searchParams.get(PREVIEW_MARKER_PARAM)).toBe("1");
  });

  it("isEmbeddedPreview detects the marker (the iframe's overlay stays dormant)", () => {
    expect(isEmbeddedPreview(`?qa=1&${PREVIEW_MARKER_PARAM}=1`)).toBe(true);
    expect(isEmbeddedPreview("?qa=1&key=abc")).toBe(false);
    expect(isEmbeddedPreview("")).toBe(false);
  });

  it("phone frame is phone-sized and styled", () => {
    expect(MOBILE_PREVIEW_WIDTH).toBe(390);
    expect(MOBILE_PREVIEW_HEIGHT).toBe(844);
    expect(QA_STYLES).toContain(".qar-preview-frame");
    expect(QA_STYLES).toContain(".qar-preview-close");
  });
});
