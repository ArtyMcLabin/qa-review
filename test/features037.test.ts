import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { scrollPreviewToSelector } from "../src/client/preview";

/**
 * 0.3.7: the mobile preview iframe loads the page at its top, so the reviewer
 * had to hand-scroll to the section under review every single time. These cover
 * the retry behaviour, because a single scroll on `load` is undone by Next
 * hydration and late images.
 */

type FakeFrame = {
  contentDocument: { querySelector: (s: string) => { scrollIntoView: (o?: unknown) => void } | null } | null;
};

function frameWith(el: { scrollIntoView: (o?: unknown) => void } | null): HTMLIFrameElement {
  const f: FakeFrame = { contentDocument: { querySelector: () => el } };
  return f as unknown as HTMLIFrameElement;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("scrollPreviewToSelector", () => {
  it("is a no-op with no iframe or no selector, and returns a callable cleanup", () => {
    expect(() => scrollPreviewToSelector(null, "#x")()).not.toThrow();
    expect(() => scrollPreviewToSelector(frameWith(null), undefined)()).not.toThrow();
  });

  it("centres the element so a tall section's top edge stays visible", () => {
    const scrollIntoView = vi.fn();
    scrollPreviewToSelector(frameWith({ scrollIntoView }), '[data-qa="hero"]');
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "center" }),
    );
  });

  it("scrolls repeatedly, not once, so a late layout shift cannot leave it parked", () => {
    const scrollIntoView = vi.fn();
    scrollPreviewToSelector(frameWith({ scrollIntoView }), "#target");
    const afterFirst = scrollIntoView.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(afterFirst).toBe(1);
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it("keeps retrying while the element is missing, then gives up instead of looping forever", () => {
    const querySelector = vi.fn(() => null);
    const f = { contentDocument: { querySelector } } as unknown as HTMLIFrameElement;
    scrollPreviewToSelector(f, "#never-there");
    vi.advanceTimersByTime(10_000);
    // bounded by SCROLL_ATTEMPTS
    expect(querySelector.mock.calls.length).toBeLessThanOrEqual(12);
    expect(querySelector.mock.calls.length).toBeGreaterThan(1);
  });

  it("cleanup cancels pending retries so switching items cannot leave two loops fighting", () => {
    const scrollIntoView = vi.fn();
    const cancel = scrollPreviewToSelector(frameWith({ scrollIntoView }), "#a");
    const before = scrollIntoView.mock.calls.length;
    cancel();
    vi.advanceTimersByTime(5_000);
    expect(scrollIntoView.mock.calls.length).toBe(before);
  });

  it("swallows a cross-origin or torn-down frame rather than throwing into the overlay", () => {
    const f = {
      get contentDocument(): never {
        throw new Error("cross-origin");
      },
    } as unknown as HTMLIFrameElement;
    expect(() => scrollPreviewToSelector(f, "#x")).not.toThrow();
  });
});
