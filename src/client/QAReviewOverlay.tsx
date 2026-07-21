"use client";

// Gamified on-page QA review overlay. An onboarding-style spotlight walkthrough:
// dims the page except the current review target, shows a card with the item's
// title/subtitle + Approve/Reject/Prev/Next, and persists verdicts as you go to
// a DURABLE server-side ledger (the state endpoint) with localStorage as a fast
// local cache. Round-based: the set of actionable (not-fully-approved) items is
// FROZEN at hydration with a fixed denominator, so approved items never
// re-appear mid-round and the counter counts up "1 of N" against a stable N.
// 🚨 There is NO reset-all anywhere: the ledger is never bulk-wiped; a single
// item is re-queued by invalidating just it (state POST with `verdict: null`).
//
// Capabilities:
// - TASK ITEMS: an item without a `selector` renders as a centered card (no
//   spotlight) with an optional action link. Same verdict/undo/note flow.
// - JOURNEY: ordered multi-page review. The moment a page's round is done the
//   overlay navigates IMMEDIATELY to the next page with pending items (no
//   interstitial); a completion panel shows only when NOTHING is pending
//   anywhere. Activation query params survive the hop.
// - NOT-ALTERED POKA-YOKE: every verdict stores a content fingerprint. A
//   re-shown REJECTED item whose content fingerprints identical gets a
//   prominent system-computed "NOT ALTERED since your rejection" badge (the
//   overlay judges by hashing - never an operating agent's claim).
// - DEVICE-SPLIT APPROVALS: items can require per-device sign-off (PC/mobile);
//   approved only when every required device approved. Plain historical
//   approvals are grandfathered as fully approved.
// - SUB-HIGHLIGHT: `highlightWords` wraps matching words inside the anchored
//   element with a secondary mark, replacing "where to look" prose.
// - CODENAMES: every item gets a stable two-word codename + "Copy ref".
// - MINIMIZE BUBBLE: the panel collapses to a draggable floating bubble
//   (mouse + touch); tapping it restores the panel.

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  PartyPopper,
  Database,
  Undo2,
  Crosshair,
  Locate,
  ExternalLink,
  Minimize2,
  Monitor,
  Smartphone,
  ClipboardCheck,
} from "lucide-react";
import type { QAReviewItem, QAResult, QATheme, QASubmission } from "./types.js";
import { isTaskItem } from "./types.js";
import { QAStore, type VerdictMap } from "./store.js";
import {
  buildJourneyNavUrl,
  fetchPendingCounts,
  journeyFinishView,
  journeyIndex,
  resolveFinishAction,
  type QAJourneyConfig,
  type QAJourneyPage,
} from "./journey.js";
import { fingerprintStatus, itemFingerprint } from "./fingerprint.js";
import {
  DEVICE_LABEL,
  DEVICE_TOOLTIP,
  approvedDevicesOf,
  detectDevice,
  isFullyApproved,
  requiredDevices,
  toggleDevice,
  type QADevice,
} from "./device.js";
import { applySubHighlights } from "./highlight.js";
import { codenameFor, formatQARef } from "../shared/codename.js";
import { ensureQAStyles } from "./styles.js";

const RING = 8; // px padding of the spotlight around the target
const CARD_W = 340;
const CARD_H = 544;
const DEFAULT_STATE_URL = "/api/qa/state";
/** Pointer movement below this (px) counts as a click, not a drag. */
const CLICK_DRAG_THRESHOLD_PX = 6;

/** Was the pointer gesture a click (vs a drag)? Exported for tests. */
export function isClickGesture(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX;
}

/** Note-reference text for a picked element: « label » (truncated) or tag. */
export function pickedElementRef(textContent: string | null, tagName: string): string {
  const label =
    (textContent || "").replace(/\s+/g, " ").trim().slice(0, 48) || tagName.toLowerCase();
  return ` «${label}» `;
}

/**
 * Element-pick mode semantics (0.3.1): LEFT click picks and exits the mode;
 * RIGHT click picks and STAYS for multi-select (context menu suppressed).
 */
export function shouldExitPickMode(button: "left" | "right"): boolean {
  return button === "left";
}

/** Viewport width at/below which the panel auto-minimizes to the bubble. */
export const AUTO_BUBBLE_MAX_WIDTH_PX = 767;

export type BubbleEvent =
  | { type: "viewport"; mobile: boolean }
  | { type: "manual"; minimized: boolean };

/**
 * Auto-bubble state machine (0.3.1): a VIEWPORT switch always applies its
 * auto state (mobile-ish width -> bubble, desktop -> panel); a MANUAL
 * minimize/restore wins immediately and holds until the NEXT viewport switch.
 * Exported for tests.
 */
export function nextMinimized(current: boolean, ev: BubbleEvent): boolean {
  return ev.type === "viewport" ? ev.mobile : ev.minimized;
}

const DEVICE_EMOJI_TIP: Record<string, string> = {
  "💻": "review on PC",
  "📱": "review on mobile",
  "💻📱": "review on PC and mobile",
};

export interface QAReviewOverlayProps {
  items: QAReviewItem[];
  /** Review bucket - persisted with every verdict (e.g. "example-site:/pricing"). */
  target: string;
  /**
   * URL param that must be present to activate the overlay (e.g. "qaReview").
   * Omit when activation is handled upstream (auth-gated lazy mount): the
   * overlay is then active immediately on mount.
   */
  gateParam?: string;
  /** State-ledger endpoint. Default "/api/qa/state". */
  stateUrl?: string;
  /**
   * Session-snapshot endpoint (e.g. "/api/qa/submit"). When set, the finish
   * panel shows a "Save review to database" button POSTing the full run there.
   * The snapshot is OPTIONAL either way: per-item verdicts always persist to
   * the state ledger in real time as they are decided.
   */
  submitUrl?: string;
  /** localStorage key builder. Default: `qa-review-verdicts:<target>`. */
  storageKey?: (target: string) => string;
  /** Brand colors for the overlay chrome (defaults are a dark yellow theme). */
  theme?: Partial<QATheme>;
  /**
   * Cross-page review journey (ordered pages with their ledger targets +
   * item ids). The page whose `target` equals this overlay's `target` is the
   * current journey position.
   */
  journey?: QAJourneyConfig;
}

type Rect = { top: number; left: number; width: number; height: number };
type SaveState = { status: "idle" | "saving" | "ok" | "error"; message?: string };
type XY = { x: number; y: number };

/** Pointer-based drag (mouse + touch). Calls onClickInstead for taps. */
function usePointerDrag(getBase: () => XY, onMove: (p: XY) => void, onClickInstead?: () => void) {
  return React.useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, textarea, input, a")) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const base = getBase();
      let moved = false;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!isClickGesture(dx, dy)) moved = true;
        if (moved) onMove({ x: base.x + dx, y: base.y + dy });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (!moved && onClickInstead) onClickInstead();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [getBase, onMove, onClickInstead],
  );
}

export function QAReviewOverlay({
  items,
  target,
  gateParam,
  stateUrl,
  submitUrl,
  storageKey,
  theme,
  journey,
}: QAReviewOverlayProps) {
  // Stable per-target store. storageKey is captured on first render by design.
  const storageKeyRef = React.useRef(storageKey);
  const store = React.useMemo(
    () => new QAStore({ target, stateUrl, storageKey: storageKeyRef.current }),
    [target, stateUrl],
  );

  const [active, setActive] = React.useState(!gateParam);
  const [hydrated, setHydrated] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const [results, setResults] = React.useState<Record<string, QAResult>>({});
  // Partial device approvals (item not yet fully approved).
  const [partials, setPartials] = React.useState<Record<string, QADevice[]>>({});
  // Stored content fingerprints per item (from the ledger / this session).
  const [fps, setFps] = React.useState<Record<string, string>>({});
  // Current item's LIVE fingerprint (system-computed, drives the badges).
  const [currentFp, setCurrentFp] = React.useState<string | null>(null);
  // The ROUND: ids of the items ACTIONABLE this session (not fully approved
  // under device-aware semantics), frozen at hydration.
  const [roundIds, setRoundIds] = React.useState<string[]>([]);
  const [note, setNote] = React.useState("");
  const [rect, setRect] = React.useState<Rect | null>(null);
  // Panel lives on the LEFT and is draggable by its header (null = default).
  const [pos, setPos] = React.useState<XY | null>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const noteRef = React.useRef<HTMLTextAreaElement>(null);
  // When set, the note effect uses this text instead of the stored note (so
  // Undo keeps what was typed instead of wiping the textarea).
  const keepNoteRef = React.useRef<string | null>(null);
  // Element-picker: click an element on the page to insert a reference into the note.
  const [picking, setPicking] = React.useState(false);
  const [finished, setFinished] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [refCopied, setRefCopied] = React.useState(false);
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });
  // Minimized-to-bubble state (replaces the old 3s peek).
  const [minimized, setMinimized] = React.useState(false);
  const [bubblePos, setBubblePos] = React.useState<XY | null>(null);
  const bubbleRef = React.useRef<HTMLDivElement>(null);
  // Stack of item ids in the order they were decided, for Undo.
  const [undoStack, setUndoStack] = React.useState<string[]>([]);
  // Journey: pending counts (for the journey-complete panel only - page-level
  // completion navigates IMMEDIATELY with no interstitial).
  const [journeyCounts, setJourneyCounts] = React.useState<Record<string, number> | null>(null);
  const [journeyComplete, setJourneyComplete] = React.useState(false);
  // The journey page a full-page navigation is in flight to (loading label).
  const [navigatingTo, setNavigatingTo] = React.useState<QAJourneyPage | null>(null);

  const journeyIdx = journey ? journeyIndex(journey.pages, target) : -1;
  const inJourney = !!journey && journeyIdx >= 0;
  const detectedDevice = React.useMemo(() => detectDevice(), []);

  // Optional opt-in gate (URL param), read on mount so SSR stays static.
  React.useEffect(() => {
    if (!gateParam) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has(gateParam)) setActive(true);
  }, [gateParam]);

  // Mirror the theme vars onto <html> so styles applied to PAGE content (the
  // sub-highlight <mark>s) resolve them - they live outside any .qar-theme
  // scope. The stylesheet also carries hard fallbacks (0.3.1 fix).
  React.useEffect(() => {
    const root = document.documentElement;
    const vars: Array<[string, string | undefined]> = [
      ["--qar-accent", theme?.accent],
      ["--qar-accent-contrast", theme?.accentContrast],
      ["--qar-panel-bg", theme?.panelBg],
      ["--qar-input-bg", theme?.inputBg],
    ];
    const prev = new Map<string, string>();
    for (const [k, v] of vars) {
      if (!v) continue;
      prev.set(k, root.style.getPropertyValue(k));
      root.style.setProperty(k, v);
    }
    return () => {
      for (const [k, old] of prev) {
        if (old) root.style.setProperty(k, old);
        else root.style.removeProperty(k);
      }
    };
  }, [theme?.accent, theme?.accentContrast, theme?.panelBg, theme?.inputBg]);

  // AUTO-BUBBLE: a viewport switch to mobile-ish width minimizes to the
  // bubble; switching back restores. Manual minimize/restore wins until the
  // next switch (see nextMinimized). Only CHANGE events apply - the initial
  // viewport never force-minimizes.
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${AUTO_BUBBLE_MAX_WIDTH_PX}px)`);
    const onChange = (e: MediaQueryListEvent) =>
      setMinimized((m) => nextMinimized(m, { type: "viewport", mobile: e.matches }));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Hydrate verdicts and LAND on the first outstanding item. The DURABLE
  // server ledger is the source of truth; localStorage is only a fast cache.
  // 🚨 The store NEVER pre-approves (no seed). The round derives from
  // DEVICE-AWARE semantics: plain historical approvals are GRANDFATHERED as
  // fully approved; device-split items stay pending until every required
  // device is approved.
  React.useEffect(() => {
    ensureQAStyles();
    let cancelled = false;
    const apply = (map: VerdictMap) => {
      if (cancelled) return;
      const restored: Record<string, QAResult> = {};
      const parts: Record<string, QADevice[]> = {};
      const storedFps: Record<string, string> = {};
      for (const [id, v] of Object.entries(map)) {
        if (v.fp) storedFps[id] = v.fp;
        if (v.verdict) {
          const it = items.find((i) => i.id === id);
          restored[id] = { id, title: it?.title ?? id, verdict: v.verdict, note: v.note, variant: v.variant };
        } else if (v.approvedDevices?.length) {
          parts[id] = approvedDevicesOf(v);
        }
      }
      setResults(restored);
      setPartials(parts);
      setFps(storedFps);
      const rIds = items
        .filter((i) => !isFullyApproved(map[i.id], requiredDevices(i)))
        .map((i) => i.id);
      setRoundIds(rIds);
      setIndex(0);
      setFinished(rIds.length === 0);
      setHydrated(true);
    };

    // Paint from the local cache first (may be empty), then reconcile to the server.
    apply(store.load());
    void (async () => {
      const server = await store.serverLoad();
      if (cancelled || !server) return;
      store.save(server); // refresh the local cache from the durable source
      apply(server);
    })();

    return () => {
      cancelled = true;
    };
    // Run once per store; items are stable for the initial hydration snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // The frozen round, resolved to items in page order.
  const roundItems = React.useMemo(() => {
    const set = new Set(roundIds);
    return items.filter((i) => set.has(i.id));
  }, [items, roundIds]);
  const roundTotal = roundItems.length;
  const current = roundItems[index] as QAReviewItem | undefined;
  const currentIsTask = !!current && isTaskItem(current);

  // Track the target element's rect: scroll it into view when the step changes,
  // then keep the spotlight glued to it on scroll/resize. Task items (no
  // selector) render as a centered card over a full-page dim instead.
  React.useEffect(() => {
    if (!active || finished || minimized || !current) return;
    const el = current.selector ? document.querySelector<HTMLElement>(current.selector) : null;
    if (!el) {
      const clear = requestAnimationFrame(() => setRect(null));
      return () => cancelAnimationFrame(clear);
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    let raf = 0;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [active, finished, minimized, current, index]);

  // SYSTEM-COMPUTED live fingerprint of the current item (drives the
  // NOT-ALTERED badge - never an agent's claim).
  React.useEffect(() => {
    if (!active || finished || !current) return;
    setCurrentFp(itemFingerprint(current, document));
  }, [active, finished, current, index]);

  // SUB-HIGHLIGHT: wrap the configured words/phrases inside the anchored
  // element; fully restored when the step changes.
  React.useEffect(() => {
    if (!active || finished || minimized || !current?.selector || !current.highlightWords?.length) return;
    const el = document.querySelector<HTMLElement>(current.selector);
    if (!el) return;
    return applySubHighlights(el, current.highlightWords);
  }, [active, finished, minimized, current]);

  // Restore any existing note when revisiting a step. keepNoteRef (set by Undo)
  // wins once so Undo keeps what was typed instead of wiping the textarea.
  React.useEffect(() => {
    if (keepNoteRef.current !== null) {
      setNote(keepNoteRef.current);
      keepNoteRef.current = null;
      return;
    }
    if (current) setNote(results[current.id]?.note ?? "");
  }, [index, current, results]);

  // Drag the panel by its header (pointer events: mouse + touch).
  const onCardDragStart = usePointerDrag(
    React.useCallback(() => {
      const r = cardRef.current?.getBoundingClientRect();
      return { x: r?.left ?? 16, y: r?.top ?? 24 };
    }, []),
    setPos,
  );

  // Drag the bubble anywhere; a plain tap/click restores the panel.
  const onBubbleDragStart = usePointerDrag(
    React.useCallback(() => {
      const r = bubbleRef.current?.getBoundingClientRect();
      return { x: r?.left ?? 16, y: r?.top ?? 24 };
    }, []),
    setBubblePos,
    React.useCallback(() => setMinimized(false), []),
  );

  // Element-picker: while picking, a click on the page (outside the panel)
  // inserts a reference to that element into the note textarea at the cursor.
  // LEFT click picks and EXITS the mode; RIGHT click picks and STAYS in the
  // mode (multi-select; the native context menu is suppressed).
  React.useEffect(() => {
    if (!picking) return;
    const pick = (e: MouseEvent, exitAfter: boolean) => {
      const el = e.target as HTMLElement | null;
      if (!el || cardRef.current?.contains(el)) return; // ignore the panel itself
      e.preventDefault();
      e.stopPropagation();
      const ref = pickedElementRef(el.textContent, el.tagName);
      const ta = noteRef.current;
      if (ta) {
        const s = ta.selectionStart ?? note.length;
        const nv = note.slice(0, s) + ref + note.slice(s);
        setNote(nv);
        requestAnimationFrame(() => {
          ta.focus();
          const p = s + ref.length;
          ta.setSelectionRange(p, p);
        });
      } else {
        setNote((n) => n + ref);
      }
      if (exitAfter) setPicking(false);
    };
    const onClick = (e: MouseEvent) => pick(e, shouldExitPickMode("left"));
    const onContextMenu = (e: MouseEvent) => pick(e, shouldExitPickMode("right"));
    const t = window.setTimeout(() => {
      document.addEventListener("click", onClick, true);
      document.addEventListener("contextmenu", onContextMenu, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [picking, note]);

  const total = items.length;

  const advance = React.useCallback(() => {
    // Advance within the FROZEN round (denominator stays fixed). The decided
    // item stays in the round so Prev can walk back; finish past the last.
    setIndex((i) => {
      if (i + 1 >= roundTotal) {
        setFinished(true);
        return i;
      }
      return i + 1;
    });
  }, [roundTotal]);

  const reject = React.useCallback(() => {
    if (!current) return;
    const trimmed = note.trim() || undefined;
    const variant = current.variations?.current;
    const fp = currentFp ?? itemFingerprint(current, document) ?? undefined;
    setResults((prev) => ({
      ...prev,
      [current.id]: { id: current.id, title: current.title, verdict: "reject", note: trimmed, variant },
    }));
    if (fp) setFps((prev) => ({ ...prev, [current.id]: fp }));
    store.cancelPendingNote(current.id); // the verdict write carries the note
    store.persist(current.id, { verdict: "reject", note: trimmed, variant, fp }); // REAL-TIME
    setUndoStack((s) => [...s, current.id]);
    advance();
  }, [current, note, currentFp, store, advance]);

  /**
   * Device approvals already in effect for an item: a full approval implies
   * every required device (incl. grandfathered plain approvals); otherwise
   * the recorded partial set.
   */
  const effectiveApprovedFor = React.useCallback(
    (item: QAReviewItem): QADevice[] =>
      results[item.id]?.verdict === "approve"
        ? requiredDevices(item)
        : (partials[item.id] ?? []),
    [results, partials],
  );

  /**
   * Device-scoped approval TOGGLE. Clicking an unapproved device approves it;
   * clicking an approved one UNSETS it (the item falls back to pending when it
   * loses full approval). The item is APPROVED - and navigation advances -
   * only when every required device is approved; rejection stays whole-item.
   * Every transition persists in real time.
   */
  const approveDevice = React.useCallback(
    (device: QADevice) => {
      if (!current) return;
      const required = requiredDevices(current);
      const trimmed = note.trim() || undefined;
      const variant = current.variations?.current;
      const fp = currentFp ?? itemFingerprint(current, document) ?? undefined;
      const wasFullyApproved = results[current.id]?.verdict === "approve";
      const { devices: newDevs, action } = toggleDevice(effectiveApprovedFor(current), device);
      const complete = action === "approve" && required.every((d) => newDevs.includes(d));
      if (fp) setFps((prev) => ({ ...prev, [current.id]: fp }));
      store.cancelPendingNote(current.id);
      setUndoStack((s) => [...s, current.id]);
      if (complete) {
        setResults((prev) => ({
          ...prev,
          [current.id]: { id: current.id, title: current.title, verdict: "approve", note: trimmed, variant },
        }));
        setPartials((prev) => {
          const next = { ...prev };
          delete next[current.id];
          return next;
        });
        store.persist(current.id, { verdict: "approve", note: trimmed, variant, fp, approvedDevices: newDevs });
        advance();
        return;
      }
      // Partial approve OR unset: the item is (or returns to) pending.
      setResults((prev) => {
        if (!prev[current.id]) return prev;
        const next = { ...prev };
        delete next[current.id]; // losing full approval clears the verdict
        return next;
      });
      setPartials((prev) => ({ ...prev, [current.id]: newDevs }));
      if (action === "unset" && wasFullyApproved) {
        // The row's verdict must clear: delete it, then re-write the fields we
        // still know (note/variant/fp + remaining devices). The write-behind
        // queue guarantees the order server-side.
        store.remove(current.id);
        store.persist(current.id, { approvedDevices: newDevs, note: trimmed, variant, fp });
      } else {
        store.persist(current.id, { approvedDevices: newDevs, note: trimmed, variant, fp });
      }
      setFinished(false);
    },
    [current, note, currentFp, results, partials, store, advance, effectiveApprovedFor],
  );

  // Undo the most recent verdict/approval: drop the WHOLE item entry locally +
  // on the server (single-item invalidation) and jump back to it.
  const undo = React.useCallback(() => {
    setUndoStack((stack) => {
      if (!stack.length) return stack;
      const id = stack[stack.length - 1];
      setResults((prev) => {
        keepNoteRef.current = prev[id]?.note ?? ""; // Undo keeps the typed note
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setPartials((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      store.remove(id);
      const idx = roundItems.findIndex((i) => i.id === id);
      setFinished(false);
      if (idx >= 0) setIndex(idx);
      return stack.slice(0, -1);
    });
  }, [roundItems, store]);

  // Jump: scroll the currently-spotlighted target back into view.
  const jump = React.useCallback(() => {
    if (!current?.selector) return;
    document.querySelector(current.selector)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [current]);

  // Full-page journey hop, preserving the QA activation query params. The
  // loading indicator persists from here until the browser unloads this page.
  const navigateTo = React.useCallback((page: QAJourneyPage) => {
    setNavigatingTo(page);
    window.location.assign(buildJourneyNavUrl(page.path, window.location.search));
  }, []);

  const prevJourneyPage = inJourney && journeyIdx > 0 ? journey!.pages[journeyIdx - 1] : null;

  const prev = React.useCallback(() => {
    if (index > 0) setIndex(index - 1);
    else if (prevJourneyPage) navigateTo(prevJourneyPage);
  }, [index, prevJourneyPage, navigateTo]);
  const next = React.useCallback(() => {
    if (index + 1 < roundTotal) setIndex(index + 1);
    else if (inJourney) setFinished(true);
  }, [index, roundTotal, inJourney]);
  const exit = React.useCallback(() => setActive(false), []);

  // The device whose approval is most actionable NOW (visual hint + "A" key):
  // the detected device if required and unapproved, else the first unapproved
  // required device. ALL buttons stay clickable regardless.
  const currentRequired = current ? requiredDevices(current) : [];
  const currentApproved = current ? effectiveApprovedFor(current) : [];
  const hintDevice: QADevice | null = current
    ? currentRequired.includes(detectedDevice) && !currentApproved.includes(detectedDevice)
      ? detectedDevice
      : (currentRequired.find((d) => !currentApproved.includes(d)) ?? null)
    : null;

  // Keyboard: A approve (hint device), R reject, ←/→, U/Ctrl+Z undo, M
  // minimize, Esc exit.
  React.useEffect(() => {
    if (!active || finished || minimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "a" || e.key === "A") {
        if (hintDevice) approveDevice(hintDevice);
      } else if (e.key === "r" || e.key === "R") reject();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "u" || e.key === "U" || ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey))) undo();
      else if (e.key === "m" || e.key === "M") setMinimized(true);
      else if (e.key === "Escape") exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, finished, minimized, reject, approveDevice, hintDevice, next, prev, exit, undo]);

  // Journey: the moment this page's round is done, resolve the next step and
  // navigate IMMEDIATELY (no interstitial, no success popup). The completion
  // panel shows ONLY when nothing is pending anywhere in the journey.
  React.useEffect(() => {
    if (!finished || !active || !inJourney) {
      setJourneyComplete(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const counts = await fetchPendingCounts(stateUrl ?? DEFAULT_STATE_URL, journey!.pages);
      if (cancelled) return;
      counts[target] = items.filter(
        (i) =>
          !isFullyApproved(
            { verdict: results[i.id]?.verdict, approvedDevices: partials[i.id] },
            requiredDevices(i),
          ),
      ).length;
      setJourneyCounts(counts);
      const action = resolveFinishAction(journey!.pages, counts, journeyIdx);
      if (action.kind === "navigate") navigateTo(action.page); // IMMEDIATE
      else setJourneyComplete(true);
    })();
    return () => {
      cancelled = true;
    };
    // Resolve once per finish; results are frozen while finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, active, inJourney]);

  const buildPayload = React.useCallback((): QASubmission => {
    const merged = items.map(
      (it) => results[it.id] ?? { id: it.id, title: it.title, verdict: "skipped" as const },
    );
    const approved = merged.filter((r) => r.verdict === "approve").length;
    const rejected = merged.filter((r) => r.verdict === "reject").length;
    return {
      target,
      reviewer: undefined,
      approved,
      rejected,
      total: items.length,
      results: merged,
    };
  }, [items, results, target]);

  const copyResults = React.useCallback(() => {
    const json = JSON.stringify(buildPayload().results, null, 2);
    navigator.clipboard.writeText(json).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {
        window.prompt("Copy QA results:", json);
      },
    );
  }, [buildPayload]);

  const copyRef = React.useCallback(() => {
    if (!current) return;
    const line = formatQARef(target, current.id, current.title);
    navigator.clipboard.writeText(line).then(
      () => {
        setRefCopied(true);
        window.setTimeout(() => setRefCopied(false), 1500);
      },
      () => {
        window.prompt("Copy QA reference:", line);
      },
    );
  }, [current, target]);

  // Persist the completed run as a session snapshot via the submit endpoint.
  const saveToDb = React.useCallback(async () => {
    if (!submitUrl) return;
    setSave({ status: "saving" });
    try {
      const res = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) setSave({ status: "ok" });
      else setSave({ status: "error", message: data?.error || `HTTP ${res.status}` });
    } catch {
      setSave({ status: "error", message: "Network error - use Copy JSON instead." });
    }
  }, [submitUrl, buildPayload]);

  if (!active || !hydrated || typeof document === "undefined") return null;

  // Inline CSS-variable overrides for the injected default theme.
  const themeStyle = {
    ...(theme?.accent ? { "--qar-accent": theme.accent } : null),
    ...(theme?.accentContrast ? { "--qar-accent-contrast": theme.accentContrast } : null),
    ...(theme?.panelBg ? { "--qar-panel-bg": theme.panelBg } : null),
    ...(theme?.inputBg ? { "--qar-input-bg": theme.inputBg } : null),
  } as React.CSSProperties;

  const approved = Object.values(results).filter((r) => r.verdict === "approve").length;
  const rejected = Object.values(results).filter((r) => r.verdict === "reject").length;

  /* ------------------------------ finish panel ------------------------------ */
  if (finished) {
    // In a journey the overlay navigates away IMMEDIATELY when other pages
    // are pending. Show an UNMISTAKABLE loading state from the moment the
    // round exhausts until the next page unloads this one - never a blank
    // screen (0.3.1: a reviewer almost exited thinking the review was done).
    if (journeyFinishView(inJourney, journeyComplete) === "loading") {
      return createPortal(
        <div className="qar-theme qar-finish-backdrop" style={themeStyle}>
          <div className="qar-loading-card" role="status" aria-live="polite">
            <div className="qar-spinner" aria-hidden />
            {navigatingTo
              ? `Loading ${navigatingTo.label ?? navigatingTo.path}…`
              : "Checking remaining pages…"}
            <span className="qar-muted" style={{ fontSize: 11, fontWeight: 400 }}>
              The review continues on the next page - do not close this tab.
            </span>
          </div>
        </div>,
        document.body,
      );
    }
    return createPortal(
      <div className="qar-theme qar-finish-backdrop" style={themeStyle}>
        <div className="qar-finish-card">
          <PartyPopper className="qar-finish-icon" size={40} aria-hidden />
          <h2 className="qar-finish-title">{inJourney ? "Journey complete" : "QA review complete"}</h2>
          <p className="qar-finish-stats">
            <span className="qar-green">{approved} approved</span> ·{" "}
            <span className="qar-red">{rejected} rejected</span> · {total} total
            {inJourney && <span className="qar-muted"> (this page)</span>}
          </p>

          <p
            className="qar-finish-autosaved"
            data-qatip="Every verdict was written to the server ledger the moment you decided it"
          >
            <Database size={14} aria-hidden /> Auto-saved to the review database as you go.
          </p>

          {inJourney && journeyCounts && (
            <div className="qar-journey">
              {journey!.pages.map((p, i) => {
                const left = journeyCounts[p.target] ?? 0;
                return (
                  <div key={p.target} className={`qar-journey-row${i === journeyIdx ? " qar-current" : ""}`}>
                    <span>
                      {p.label ?? p.path}
                      {i === journeyIdx ? " (here)" : ""}
                    </span>
                    <span className={left === 0 ? "qar-journey-done" : "qar-journey-left"}>
                      {left === 0 ? "✓ done" : `${left} left`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="qar-finish-actions">
            {submitUrl && (
              <>
                <button
                  type="button"
                  onClick={saveToDb}
                  disabled={save.status === "saving" || save.status === "ok"}
                  className="qar-btn-primary"
                  data-qatip="Store a snapshot of this whole run (verdicts are already saved individually)"
                >
                  <Database size={16} aria-hidden />
                  {save.status === "saving"
                    ? "Saving…"
                    : save.status === "ok"
                      ? "Saved to database ✓"
                      : "Save review to database"}
                </button>
                {save.status === "error" && <p className="qar-warn">{save.message}</p>}
              </>
            )}
            <button
              type="button"
              onClick={copyResults}
              className="qar-btn-outline-accent"
              data-qatip="Copy all verdicts of this page as JSON"
            >
              <ClipboardCopy size={16} aria-hidden />
              {copied ? "Copied!" : "Copy JSON"}
            </button>
            {roundTotal > 0 && (
              <button
                type="button"
                onClick={() => {
                  setFinished(false);
                  setIndex(0);
                }}
                className="qar-btn-outline"
              >
                Back to review
              </button>
            )}
            <button type="button" onClick={exit} className="qar-btn-ghost">
              Exit QA mode
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  if (!current) return null;

  /* ---------------------------- minimized bubble ---------------------------- */
  if (minimized) {
    const bubbleStyle: React.CSSProperties = bubblePos
      ? { top: bubblePos.y, left: bubblePos.x }
      : { bottom: 24, right: 24 };
    return createPortal(
      <div
        ref={bubbleRef}
        className="qar-theme qar-bubble"
        style={{ ...themeStyle, ...bubbleStyle }}
        onPointerDown={onBubbleDragStart}
        role="button"
        aria-label="Restore the QA review panel"
        data-qatip="QA review (tap to restore, drag to move)"
      >
        <ClipboardCheck size={24} aria-hidden />
        <span className="qar-bubble-count" data-qatip="Items left to review on this page">
          {Math.max(roundTotal - index, 0)}
        </span>
      </div>,
      document.body,
    );
  }

  const existing = results[current.id]?.verdict;
  const approvedCount = items.filter((it) => results[it.id]?.verdict === "approve").length;
  const decidedInRound = roundItems.filter((it) => results[it.id]?.verdict).length;
  const hasNext = index < roundTotal - 1 || inJourney;
  const hasPrev = index > 0 || !!prevJourneyPage;
  const codename = codenameFor(target, current.id);
  // NOT-ALTERED poka-yoke: system-computed comparison of the fingerprint saved
  // with the last REJECTION vs the page content right now.
  const fpStatus = existing === "reject" ? fingerprintStatus(fps[current.id], currentFp) : null;
  const partialApproved = currentApproved.filter((d) => currentRequired.includes(d));
  const multiDevice = currentRequired.length > 1;

  return createPortal(
    <>
      {/* Spotlight: a box-shadow-spread dim over everything except the target.
          Task items get a plain full-page dim (no spotlight hole). */}
      {rect && !currentIsTask ? (
        <div
          aria-hidden
          className="qar-theme qar-spotlight"
          style={{
            ...themeStyle,
            top: rect.top - RING,
            left: rect.left - RING,
            width: rect.width + RING * 2,
            height: rect.height + RING * 2,
          }}
        />
      ) : (
        <div aria-hidden className="qar-theme qar-dim" style={themeStyle} />
      )}

      {/* Review card */}
      <div
        ref={cardRef}
        className="qar-theme qar-card"
        style={{
          ...themeStyle,
          ...(pos
            ? { top: pos.y, left: pos.x }
            : currentIsTask
              ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
              : { top: 24, left: 16 }),
          width: CARD_W,
          height: CARD_H,
        }}
      >
        <div
          className="qar-card-header"
          onPointerDown={onCardDragStart}
          style={{ cursor: "move" }}
          data-qatip="Drag to move the panel"
        >
          <span className="qar-counter" data-qatip="Position in this page's review round">
            {index + 1} of {roundTotal} to review
            {inJourney && (
              <span className="qar-muted" data-qatip="Journey progress across the reviewed pages">
                {" "}
                · page {journeyIdx + 1}/{journey!.pages.length}
              </span>
            )}
          </span>
          <span className="qar-header-tools">
            {current.device && (
              <span data-qatip={DEVICE_EMOJI_TIP[current.device] ?? "target viewport(s)"}>{current.device}</span>
            )}
            {!currentIsTask && (
              <button
                type="button"
                onClick={jump}
                aria-label="Jump to the highlighted section"
                data-qatip="Jump: scroll to the highlighted section"
                className="qar-tool-btn"
              >
                <Locate size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={undo}
              disabled={!undoStack.length}
              aria-label="Undo the last approve/reject"
              data-qatip="Undo the last approve/reject (U or Ctrl+Z)"
              className="qar-tool-btn"
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              onClick={() => setMinimized(true)}
              aria-label="Minimize to a floating bubble"
              data-qatip="Minimize: collapse into a floating bubble (M). Tap the bubble to restore."
              className="qar-tool-btn"
            >
              <Minimize2 size={14} />
            </button>
            <button
              type="button"
              onClick={exit}
              aria-label="Exit QA mode"
              data-qatip="Exit QA mode (Esc)"
              className="qar-close-btn"
            >
              <X size={16} />
            </button>
          </span>
        </div>

        <div
          className="qar-ref-row"
          data-qatip="Stable codename for this item - say or paste it to reference the item in chat"
        >
          <span className="qar-codename">{codename}</span>
          <button
            type="button"
            onClick={copyRef}
            className="qar-pick-btn"
            data-qatip="Copy a reference line (codename + target + item id) for chat/issues"
          >
            <ClipboardCopy size={12} /> {refCopied ? "Copied!" : "Copy ref"}
          </button>
        </div>

        {/* Scrollable middle so the card keeps a STATIC height; the note field
            stretches to fill the space above the action buttons. */}
        <div className="qar-card-body">
          {!rect && !currentIsTask && (
            <p className="qar-warn">
              Target not on this viewport ({current.selector}) - may be a mobile-only element.
            </p>
          )}

          <h3 className="qar-item-title">{current.title}</h3>
          {current.sub && (
            <div className="qar-item-sub">
              {current.sub
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
            </div>
          )}

          {current.action && (
            <a
              className="qar-action-link"
              href={current.action.href}
              target="_blank"
              rel="noopener noreferrer"
              data-qatip={`Open ${current.action.href} in a new tab`}
            >
              <ExternalLink size={14} aria-hidden /> {current.action.label ?? "Open"}
            </a>
          )}

          {/* NOT-ALTERED poka-yoke (system-computed, never an agent's claim). */}
          {fpStatus === "unchanged" && (
            <p
              className="qar-fp-unchanged"
              data-qatip="The content hash equals the hash recorded when you rejected this item - it was not altered"
            >
              ⚠ NOT ALTERED since your rejection
              {results[current.id]?.note && <small>Your rejection note: {results[current.id]!.note}</small>}
            </p>
          )}
          {fpStatus === "changed" && (
            <p
              className="qar-fp-changed"
              data-qatip="The content hash differs from the one recorded at your last verdict"
            >
              Changed since your last review.
            </p>
          )}

          {existing && fpStatus !== "unchanged" && (
            <p className={`qar-recorded ${existing === "approve" ? "qar-recorded-approve" : "qar-recorded-reject"}`}>
              Recorded: {existing}
            </p>
          )}

          {multiDevice && partialApproved.length > 0 && (
            <p
              className="qar-partial-note"
              data-qatip="Approved on some required devices; the item stays pending until all are approved"
            >
              {partialApproved.map((d) => DEVICE_LABEL[d]).join(" + ")} approved ✓ - awaiting{" "}
              {currentRequired
                .filter((d) => !partialApproved.includes(d))
                .map((d) => DEVICE_LABEL[d])
                .join(" + ")}
            </p>
          )}

          {current.variations && (
            <div className="qar-var-wrap">
              <p className="qar-var-label">Preview a variation (click to swap live)</p>
              <div className="qar-var-btns">
                {Array.from({ length: current.variations.count }, (_, k) => {
                  const v = k + 1;
                  const on = current.variations!.current === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => current.variations!.onSelect(v)}
                      className={`qar-var-btn${on ? " qar-on" : ""}`}
                      data-qatip={`Preview variant ${v} live on the page`}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
              <p className="qar-var-note">Approving records variant #{current.variations.current}.</p>
            </div>
          )}

          <div className="qar-note-row">
            <span className="qar-note-label">Note</span>
            <button
              type="button"
              onClick={() => setPicking((p) => !p)}
              data-qatip="Click, then click any element on the page to drop a reference into the note. Left click picks + exits; RIGHT click picks and stays for multi-select."
              className={`qar-pick-btn${picking ? " qar-picking" : ""}`}
            >
              <Crosshair size={12} /> {picking ? "Click an element… (right-click = pick more)" : "Pick element"}
            </button>
          </div>
          <textarea
            ref={noteRef}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              // REAL-TIME note persistence (debounced): typed notes reach the
              // durable ledger even if the item is never re-verdicted.
              if (current) store.persistNoteDebounced(current.id, e.target.value);
            }}
            placeholder="Optional note (esp. on reject). Use 'Pick element' to reference a spot on the page…"
            className="qar-note-input"
          />
        </div>

        <div className="qar-actions">
          <button
            type="button"
            onClick={prev}
            disabled={!hasPrev}
            aria-label="Previous item"
            data-qatip={
              index === 0 && prevJourneyPage
                ? `Back to ${prevJourneyPage.label ?? prevJourneyPage.path}`
                : "Previous item (←)"
            }
            className="qar-nav-btn"
          >
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={reject} className="qar-reject-btn" data-qatip="Reject this item (R)">
            <X size={16} /> Reject
          </button>
          {currentRequired.map((d) => {
            const done = partialApproved.includes(d);
            const isHint = hintDevice === d;
            const cls = multiDevice
              ? `${isHint ? "qar-approve-btn" : "qar-approve-alt"}${done ? " qar-dev-done" : ""}`
              : "qar-approve-btn";
            return (
              <button
                key={d}
                type="button"
                onClick={() => approveDevice(d)}
                className={cls}
                data-qatip={`${DEVICE_TOOLTIP[d]}${isHint ? " (A)" : ""}${done ? " - already approved" : ""}`}
              >
                {multiDevice ? (
                  d === "pc" ? (
                    <Monitor size={16} aria-hidden />
                  ) : (
                    <Smartphone size={16} aria-hidden />
                  )
                ) : (
                  <Check size={16} aria-hidden />
                )}
                {multiDevice ? `${done ? "✓ " : ""}${DEVICE_LABEL[d]}` : "Approve"}
              </button>
            );
          })}
          <button
            type="button"
            onClick={next}
            disabled={!hasNext}
            aria-label="Next item"
            data-qatip={
              index >= roundTotal - 1 && inJourney
                ? "Finish this page and continue the journey (→)"
                : "Next item (→)"
            }
            className="qar-nav-btn"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="qar-footer">
          <span data-qatip="Keyboard shortcuts">keys: A approve · R reject · ←/→ · U undo · M minimize · Esc</span>
          <span>
            <span className="qar-footer-green" data-qatip="Items decided in this round">
              {decidedInRound}/{roundTotal} this round
            </span>{" "}
            <span data-qatip="Fully approved items on this page">· {approvedCount} approved total</span>
          </span>
        </div>
      </div>
    </>,
    document.body,
  );
}
