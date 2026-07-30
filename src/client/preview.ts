"use client";

// Mobile preview (0.3.5): render the CURRENT page in a phone-sized, framed
// same-origin iframe on a dimmed backdrop, so "Approve Mobile" can be
// exercised on desktop without devtools. The iframe URL keeps the QA
// activation params but adds a marker param that tells the overlay INSIDE the
// iframe to stay dormant (no nested review chrome).

/** Phone frame dimensions (iPhone-ish portrait). */
export const MOBILE_PREVIEW_WIDTH = 390;
export const MOBILE_PREVIEW_HEIGHT = 844;

/** Marker param: an overlay whose URL carries it never activates. */
export const PREVIEW_MARKER_PARAM = "qaMobilePreview";

/** Current URL with the embed marker appended (QA params preserved). */
export function buildMobilePreviewUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set(PREVIEW_MARKER_PARAM, "1");
  return url.toString();
}

/** True when THIS document is the embedded preview (overlay must not mount). */
export function isEmbeddedPreview(search: string): boolean {
  try {
    return new URLSearchParams(search).has(PREVIEW_MARKER_PARAM);
  } catch {
    return false;
  }
}

/* --------------------------- scroll-to-item ------------------------------- */
// 0.3.7 fix: the preview iframe loads the page at its TOP, so opening the phone
// frame showed the header instead of the section under review - the reviewer had
// to hunt for it by hand, on every item (a reviewer, 2026-07-30, reported twice).
//
// The frame is same-origin, so the parent can reach into its document directly.
// We retry rather than scroll once: the iframe fires `load` before Next.js has
// hydrated and before images have settled, and an early scroll gets undone by
// the layout shift that follows.

/** How many attempts, and how far apart, to land the scroll. */
const SCROLL_ATTEMPTS = 12;
const SCROLL_INTERVAL_MS = 120;

/**
 * Scroll the preview iframe so `selector` is centred in the phone frame.
 *
 * Returns a cleanup function that cancels any pending retries, so a caller that
 * switches items mid-flight does not have two scroll loops fighting.
 *
 * A missing element is NOT an error: plenty of items are desktop-only, and the
 * overlay already surfaces "target not on this viewport" separately. We simply
 * keep retrying until the attempts run out, in case it is merely late.
 */
export function scrollPreviewToSelector(
  iframe: HTMLIFrameElement | null,
  selector: string | undefined,
): () => void {
  if (!iframe || !selector) return () => {};

  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const tick = () => {
    if (cancelled) return;
    attempts += 1;
    try {
      const doc = iframe.contentDocument;
      const el = doc?.querySelector<HTMLElement>(selector);
      if (el) {
        // "center" keeps a tall section's top edge visible in a 844px frame,
        // which "start" does not once a sticky header is in play.
        el.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
        // Keep going a couple more rounds: late-loading images below the fold
        // routinely shove the target back off screen after a correct scroll.
        if (attempts >= 3) return;
      }
    } catch {
      /* cross-origin or frame torn down mid-flight: nothing to do */
    }
    if (attempts < SCROLL_ATTEMPTS) timer = setTimeout(tick, SCROLL_INTERVAL_MS);
  };

  tick();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

/* ------------------------- live variant propagation ------------------------ */
// When the phone-frame preview is OPEN and the reviewer picks a different
// variation, the variant must apply INSIDE the iframe document without a
// close+reopen. The parent posts the variant to the same-origin iframe; the
// embedded (dormant) overlay applies it by running the consumer's own
// variation callback there - so the DOM mutation executes in the iframe's
// document, not just the parent.

export const PREVIEW_MESSAGE_TYPE = "qa-review:variant";

export interface VariantMessage {
  type: typeof PREVIEW_MESSAGE_TYPE;
  itemId: string;
  variant: number;
}

/** Post a variant change to the open preview iframe (same-origin). */
export function postVariantToPreview(
  iframe: HTMLIFrameElement | null,
  itemId: string,
  variant: number,
): void {
  const win = iframe?.contentWindow;
  if (!win) return;
  const msg: VariantMessage = { type: PREVIEW_MESSAGE_TYPE, itemId, variant };
  try {
    win.postMessage(msg, window.location.origin);
  } catch {
    /* best-effort */
  }
}

/** Parse a message event into a VariantMessage, or null if it isn't one. */
export function parseVariantMessage(data: unknown): VariantMessage | null {
  if (
    data &&
    typeof data === "object" &&
    (data as { type?: unknown }).type === PREVIEW_MESSAGE_TYPE &&
    typeof (data as VariantMessage).itemId === "string" &&
    typeof (data as VariantMessage).variant === "number"
  ) {
    return data as VariantMessage;
  }
  return null;
}
