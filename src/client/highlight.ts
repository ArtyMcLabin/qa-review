"use client";

// Sub-highlight: on top of the element spotlight, wrap specific words/phrases
// INSIDE the anchored element with a secondary highlight mark - the question
// stays terse and the highlight replaces any "where to look" prose.

export interface MatchRange {
  start: number;
  end: number;
}

/**
 * Case-insensitive, all-occurrence match ranges of the phrases inside a text.
 * Overlapping later matches are dropped so ranges never intersect. Pure and
 * unit-tested; the DOM wrapper below applies the same logic per text node.
 */
export function findMatchRanges(text: string, phrases: readonly string[]): MatchRange[] {
  const hay = text.toLowerCase();
  const ranges: MatchRange[] = [];
  for (const raw of phrases) {
    const needle = raw.toLowerCase().trim();
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at === -1) break;
      ranges.push({ start: at, end: at + needle.length });
      from = at + needle.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: MatchRange[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r.start < last.end) continue; // drop overlaps
    out.push(r);
  }
  return out;
}

const MARK_CLASS = "qar-subhl";

/**
 * Wrap phrase matches inside the element's text nodes with <mark> elements.
 * Matches are found WITHIN single text nodes (phrases spanning element
 * boundaries are not wrapped - keep highlight phrases short). Returns a
 * cleanup function that fully restores the original DOM.
 */
export function applySubHighlights(el: HTMLElement, phrases: readonly string[]): () => void {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text);

  const marks: HTMLElement[] = [];
  for (const node of textNodes) {
    const text = node.nodeValue ?? "";
    const ranges = findMatchRanges(text, phrases);
    if (!ranges.length) continue;
    const frag = doc.createDocumentFragment();
    let cursor = 0;
    for (const r of ranges) {
      if (r.start > cursor) frag.appendChild(doc.createTextNode(text.slice(cursor, r.start)));
      const mark = doc.createElement("mark");
      mark.className = MARK_CLASS;
      mark.textContent = text.slice(r.start, r.end);
      frag.appendChild(mark);
      marks.push(mark);
      cursor = r.end;
    }
    if (cursor < text.length) frag.appendChild(doc.createTextNode(text.slice(cursor)));
    node.parentNode?.replaceChild(frag, node);
  }

  return () => {
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(doc.createTextNode(mark.textContent ?? ""), mark);
      parent.normalize();
    }
  };
}
