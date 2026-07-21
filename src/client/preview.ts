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
