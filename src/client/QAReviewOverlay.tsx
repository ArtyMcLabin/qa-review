"use client";

// Gamified on-page QA review overlay. An onboarding-style spotlight walkthrough:
// dims the page except the current review target, shows a card with the item's
// title/subtitle + Approve/Reject/Prev/Next, and persists verdicts as you go to
// a DURABLE server-side ledger (the state endpoint) with localStorage as a fast
// local cache. Round-based: the set of actionable (not-yet-approved) items is
// FROZEN at hydration with a fixed denominator, so approved items never
// re-appear mid-round and the counter counts up "1 of N" against a stable N.
// 🚨 There is NO reset-all anywhere: the ledger is never bulk-wiped; a single
// item is re-queued by invalidating just it (state POST with `verdict: null`).

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  PartyPopper,
  Eye,
  Database,
  Undo2,
  Crosshair,
  Locate,
} from "lucide-react";
import type { QAReviewItem, QAResult, QATheme, QAVerdict, QASubmission } from "./types.js";
import { QAStore, type VerdictMap } from "./store.js";
import { ensureQAStyles } from "./styles.js";

const RING = 8; // px padding of the spotlight around the target
const CARD_W = 340;
const CARD_H = 544;

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
}

type Rect = { top: number; left: number; width: number; height: number };
type SaveState = { status: "idle" | "saving" | "ok" | "error"; message?: string };

export function QAReviewOverlay({
  items,
  target,
  gateParam,
  stateUrl,
  submitUrl,
  storageKey,
  theme,
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
  // The ROUND: ids of the items that are ACTIONABLE this session (not yet
  // approved), frozen at hydration. The overlay steps through ONLY these, with
  // a FIXED denominator, so approved/unchanged items never re-appear.
  const [roundIds, setRoundIds] = React.useState<string[]>([]);
  const [note, setNote] = React.useState("");
  const [rect, setRect] = React.useState<Rect | null>(null);
  // Panel lives on the LEFT and is draggable by its header (null = default left).
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const noteRef = React.useRef<HTMLTextAreaElement>(null);
  // When set, the note effect uses this text instead of the stored note (so
  // Undo keeps what was typed instead of wiping the textarea).
  const keepNoteRef = React.useRef<string | null>(null);
  // Element-picker: click an element on the page to insert a reference into the note.
  const [picking, setPicking] = React.useState(false);
  const [finished, setFinished] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });
  // 3-second "peek": hide the overlay chrome so the page reads as final.
  const [peeking, setPeeking] = React.useState(false);
  // Stack of item ids in the order they were decided, for Undo.
  const [undoStack, setUndoStack] = React.useState<string[]>([]);
  const peek = React.useCallback(() => {
    setPeeking(true);
    window.setTimeout(() => setPeeking(false), 3000);
  }, []);

  // Optional opt-in gate (URL param), read on mount so SSR stays static.
  React.useEffect(() => {
    if (!gateParam) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has(gateParam)) setActive(true);
  }, [gateParam]);

  // Hydrate verdicts and LAND on the first outstanding (unreviewed OR rejected)
  // item. The DURABLE server ledger is the source of truth - it survives a
  // browser cookie/localStorage wipe; localStorage is only a fast cache for
  // instant paint before the server responds. 🚨 The store NEVER pre-approves
  // (no seed): a fresh/empty store can never open as "complete".
  React.useEffect(() => {
    ensureQAStyles();
    let cancelled = false;
    const apply = (map: VerdictMap) => {
      if (cancelled) return;
      const restored: Record<string, QAResult> = {};
      for (const [id, v] of Object.entries(map)) {
        if (!v.verdict) continue; // variant-only entries carry no verdict
        const it = items.find((i) => i.id === id);
        restored[id] = { id, title: it?.title ?? id, verdict: v.verdict, note: v.note, variant: v.variant };
      }
      setResults(restored);
      // Freeze the round = every item NOT already approved (unreviewed OR
      // rejected), in page order. Empty round => nothing to do => finish panel.
      const rIds = items.filter((i) => map[i.id]?.verdict !== "approve").map((i) => i.id);
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

  // The frozen round, resolved to items in page order. Navigation + the counter
  // work over THIS list, not the full item set.
  const roundItems = React.useMemo(() => {
    const set = new Set(roundIds);
    return items.filter((i) => set.has(i.id));
  }, [items, roundIds]);
  const roundTotal = roundItems.length;
  const current = roundItems[index] as QAReviewItem | undefined;

  // Track the target element's rect: scroll it into view when the step changes,
  // then keep the spotlight glued to it on scroll/resize.
  React.useEffect(() => {
    if (!active || finished || !current) return;
    const el = document.querySelector<HTMLElement>(current.selector);
    if (!el) {
      // Clear inside a frame (not synchronously in the effect body): avoids a
      // cascading render per the react-hooks lint.
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
  }, [active, finished, current, index]);

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

  // Drag the panel by its header.
  const onDragStart = React.useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, textarea, input, a")) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const r = cardRef.current?.getBoundingClientRect();
    const baseX = r?.left ?? 16;
    const baseY = r?.top ?? 24;
    const move = (ev: MouseEvent) => setPos({ x: baseX + (ev.clientX - startX), y: baseY + (ev.clientY - startY) });
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, []);

  // Element-picker: next click on the page (outside the panel) inserts a
  // reference to that element into the note textarea at the cursor.
  React.useEffect(() => {
    if (!picking) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || cardRef.current?.contains(el)) return; // ignore the panel itself
      e.preventDefault();
      e.stopPropagation();
      const label = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48) || el.tagName.toLowerCase();
      const ref = ` «${label}» `;
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
      setPicking(false);
    };
    const t = window.setTimeout(() => document.addEventListener("click", onClick, true), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", onClick, true);
    };
  }, [picking, note]);

  const total = items.length;

  const record = React.useCallback(
    (verdict: QAVerdict) => {
      if (!current) return;
      const trimmed = note.trim() || undefined;
      const variant = current.variations?.current;
      setResults((prev) => ({
        ...prev,
        [current.id]: { id: current.id, title: current.title, verdict, note: trimmed, variant },
      }));
      store.cancelPendingNote(current.id); // the verdict write carries the note
      store.persist(current.id, { verdict, note: trimmed, variant }); // REAL-TIME durable mirror
      setUndoStack((s) => [...s, current.id]);
      // Advance within the FROZEN round (denominator stays fixed). The decided
      // item stays in the round so Prev can walk back to it; finish when past
      // the last round item.
      if (index + 1 >= roundTotal) setFinished(true);
      else setIndex(index + 1);
    },
    [current, note, index, roundTotal, store],
  );

  // Undo the most recent verdict: drop it locally + on the server (single-item
  // invalidation) and jump back to that item so it can be re-decided.
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
      store.remove(id);
      const idx = roundItems.findIndex((i) => i.id === id);
      setFinished(false);
      if (idx >= 0) setIndex(idx);
      return stack.slice(0, -1);
    });
  }, [roundItems, store]);

  // Jump: scroll the currently-spotlighted target back into view.
  const jump = React.useCallback(() => {
    if (!current) return;
    document.querySelector(current.selector)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [current]);

  // Prev/Next step within the frozen round (approved/unchanged items are not in
  // the round, so they never re-appear).
  const prev = React.useCallback(() => {
    if (index > 0) setIndex(index - 1);
  }, [index]);
  const next = React.useCallback(() => {
    if (index + 1 < roundTotal) setIndex(index + 1);
  }, [index, roundTotal]);
  const exit = React.useCallback(() => setActive(false), []);

  // Keyboard: A approve, R reject, ←/→ prev/next, U/Ctrl+Z undo, Esc exit.
  React.useEffect(() => {
    if (!active || finished) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "a" || e.key === "A") record("approve");
      else if (e.key === "r" || e.key === "R") record("reject");
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "u" || e.key === "U" || ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey))) undo();
      else if (e.key === "Escape") exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, finished, record, next, prev, exit, undo]);

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

  // Persist the completed run as a session snapshot via the submit endpoint.
  // Clipboard-JSON stays available as the fallback.
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
    return createPortal(
      <div className="qar-theme qar-finish-backdrop" style={themeStyle}>
        <div className="qar-finish-card">
          <PartyPopper className="qar-finish-icon" size={40} aria-hidden />
          <h2 className="qar-finish-title">QA review complete</h2>
          <p className="qar-finish-stats">
            <span className="qar-green">{approved} approved</span> ·{" "}
            <span className="qar-red">{rejected} rejected</span> · {total} total
          </p>

          <p className="qar-finish-autosaved">
            <Database size={14} aria-hidden /> Auto-saved to the review database as you go.
          </p>

          <div className="qar-finish-actions">
            {submitUrl && (
              <>
                <button
                  type="button"
                  onClick={saveToDb}
                  disabled={save.status === "saving" || save.status === "ok"}
                  className="qar-btn-primary"
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
            <button type="button" onClick={copyResults} className="qar-btn-outline-accent">
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

  if (peeking) return null; // 3s clean-page peek; chrome returns automatically

  // Panel is pinned to the LEFT by default (so it never obscures the page) and
  // can be dragged anywhere by its header.
  const cardTop = pos?.y ?? 24;
  const cardLeft = pos?.x ?? 16;

  const existing = results[current.id]?.verdict;
  const approvedCount = items.filter((it) => results[it.id]?.verdict === "approve").length;
  // Decided-this-round = round items that now carry a verdict (counts up 0..roundTotal).
  const decidedInRound = roundItems.filter((it) => results[it.id]?.verdict).length;
  const hasNext = index < roundTotal - 1;
  const hasPrev = index > 0;

  return createPortal(
    <>
      {/* Spotlight: a box-shadow-spread dim over everything except the target. */}
      {rect ? (
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
        style={{ ...themeStyle, top: cardTop, left: cardLeft, width: CARD_W, height: CARD_H }}
      >
        <div
          className="qar-card-header"
          onMouseDown={onDragStart}
          style={{ cursor: "move" }}
          title="Drag to move the panel"
        >
          <span className="qar-counter">
            {index + 1} of {roundTotal} to review
          </span>
          <span className="qar-header-tools">
            {current.device && <span>{current.device}</span>}
            <button
              type="button"
              onClick={jump}
              aria-label="Jump to the highlighted section"
              title="Jump: scroll to the highlighted section"
              className="qar-tool-btn"
            >
              <Locate size={14} />
            </button>
            <button
              type="button"
              onClick={undo}
              disabled={!undoStack.length}
              aria-label="Undo the last approve/reject"
              title="Undo the last approve/reject (U or Ctrl+Z)"
              className="qar-tool-btn"
            >
              <Undo2 size={14} />
            </button>
            <button
              type="button"
              onClick={peek}
              aria-label="Peek at the final page for 3 seconds"
              title="Peek: hide the panel for 3s to see the page clean"
              className="qar-tool-btn"
            >
              <Eye size={14} />
            </button>
            <button type="button" onClick={exit} aria-label="Exit QA mode" className="qar-close-btn">
              <X size={16} />
            </button>
          </span>
        </div>

        {/* Scrollable middle so the card keeps a STATIC height and the action
            buttons below stay pinned in the same place for every item. */}
        <div className="qar-card-body">
          {!rect && (
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

          {existing && (
            <p className={`qar-recorded ${existing === "approve" ? "qar-recorded-approve" : "qar-recorded-reject"}`}>
              Recorded: {existing}
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
              title="Click, then click any element on the page to drop a reference to it into the note"
              className={`qar-pick-btn${picking ? " qar-picking" : ""}`}
            >
              <Crosshair size={12} /> {picking ? "Click an element…" : "Pick element"}
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
            rows={2}
            className="qar-note-input"
          />
        </div>

        <div className="qar-actions">
          <button type="button" onClick={prev} disabled={!hasPrev} aria-label="Previous item" className="qar-nav-btn">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => record("reject")} className="qar-reject-btn">
            <X size={16} /> Reject
          </button>
          <button type="button" onClick={() => record("approve")} className="qar-approve-btn">
            <Check size={16} /> Approve
          </button>
          <button type="button" onClick={next} disabled={!hasNext} aria-label="Next item" className="qar-nav-btn">
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="qar-footer">
          <span>keys: A approve · R reject · ←/→ · Esc</span>
          <span>
            <span className="qar-footer-green">
              {decidedInRound}/{roundTotal} this round
            </span>{" "}
            · {approvedCount} approved total
          </span>
        </div>
      </div>
    </>,
    document.body,
  );
}
