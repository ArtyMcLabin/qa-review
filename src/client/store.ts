"use client";

// Client-side verdict persistence: localStorage as a fast cache for instant
// paint, plus a REAL-TIME mirror to the durable server ledger (the state
// endpoint). Every accept/reject/note-change/undo writes to the server
// immediately; failed writes are queued (write-behind, persisted in
// localStorage) and retried on the next action - a verdict is never lost
// silently, and hydration replays the pending queue over the server map so an
// offline verdict cannot be clobbered by a reload.
//
// 🚨 Deliberately DUMB (hard-won lesson): nothing is EVER pre-approved; a
// fresh/empty store = every item unreviewed; the store only holds verdicts the
// reviewer actually clicked. There is NO bulk reset - a single item is re-queued
// by deleting just its verdict (server: `verdict: null`).

import type { QAVerdict } from "./types.js";

export interface PersistedVerdict {
  verdict?: QAVerdict;
  variant?: number;
  note?: string;
}

/** item id -> persisted verdict/variant/note. */
export type VerdictMap = Record<string, PersistedVerdict>;

/** One queued server write. `patch: null` = delete (undo / invalidation). */
export interface PendingOp {
  itemId: string;
  patch: PersistedVerdict | null;
}

export interface QAStoreOptions {
  /** Review bucket this store reads/writes (e.g. "example-site:/pricing"). */
  target: string;
  /** State endpoint URL. Default "/api/qa/state". */
  stateUrl?: string;
  /** localStorage key builder. Default: target-suffixed generic key. */
  storageKey?: (target: string) => string;
  /** Debounce for real-time note persistence, ms. Default 600. */
  noteDebounceMs?: number;
}

const DEFAULT_STATE_URL = "/api/qa/state";
const defaultStorageKey = (target: string) => `qa-review-verdicts:${target}`;

function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/**
 * Per-target verdict store. Construct one per review bucket; the overlay
 * creates its own from props, and page wrappers may construct an identical one
 * to persist variant picks outside the overlay.
 */
export class QAStore {
  readonly target: string;
  private readonly stateUrl: string;
  private readonly key: string;
  private readonly pendingKey: string;
  private readonly noteDebounceMs: number;
  private flushing = false;
  private noteTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(opts: QAStoreOptions) {
    this.target = opts.target;
    this.stateUrl = opts.stateUrl ?? DEFAULT_STATE_URL;
    this.key = (opts.storageKey ?? defaultStorageKey)(opts.target);
    this.pendingKey = `${this.key}::pending`;
    this.noteDebounceMs = opts.noteDebounceMs ?? 600;
  }

  /* ------------------------------ local cache ------------------------------ */

  /**
   * Load the local verdict map. Returns an empty map (every item unreviewed)
   * when the key was never written or is unparseable. NEVER seeds approvals.
   */
  load(): VerdictMap {
    if (!hasStorage()) return {};
    const raw = window.localStorage.getItem(this.key);
    if (raw === null) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as VerdictMap) : {};
    } catch {
      return {};
    }
  }

  save(map: VerdictMap): void {
    if (!hasStorage()) return;
    window.localStorage.setItem(this.key, JSON.stringify(map));
  }

  /** Merge-write a single item's fields locally (read-modify-write). */
  persistLocal(id: string, patch: PersistedVerdict): void {
    const map = this.load();
    map[id] = { ...map[id], ...patch };
    this.save(map);
  }

  /** Delete a single item's verdict locally (undo). */
  removeLocal(id: string): void {
    if (!hasStorage()) return;
    const map = this.load();
    delete map[id];
    this.save(map);
  }

  /* ----------------------- write-behind pending queue ----------------------- */
  // Every server write goes through this queue. On success it drains
  // immediately (real-time); on failure the ops stay (persisted in
  // localStorage so they survive a reload) and are replayed IN ORDER before
  // any later server interaction. A verdict is never lost silently.

  /** Read the persisted pending-op queue. */
  pendingOps(): PendingOp[] {
    if (!hasStorage()) return [];
    const raw = window.localStorage.getItem(this.pendingKey);
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as PendingOp[]) : [];
    } catch {
      return [];
    }
  }

  private savePending(ops: PendingOp[]): void {
    if (!hasStorage()) return;
    if (ops.length === 0) window.localStorage.removeItem(this.pendingKey);
    else window.localStorage.setItem(this.pendingKey, JSON.stringify(ops));
  }

  /** POST one op to the state endpoint. Resolves false on any failure. */
  private async sendOp(op: PendingOp): Promise<boolean> {
    try {
      const body =
        op.patch === null
          ? { target: this.target, itemId: op.itemId, verdict: null }
          : { target: this.target, itemId: op.itemId, ...op.patch };
      const r = await fetch(this.stateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  /**
   * Replay the pending queue in order; stops at the first failure (the rest
   * retries on the next action). Concurrency-guarded so parallel triggers
   * cannot double-send.
   */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      let ops = this.pendingOps();
      while (ops.length) {
        const ok = await this.sendOp(ops[0]);
        if (!ok) break; // offline / server down: keep the queue, retry later
        ops = this.pendingOps().slice(1); // re-read: actions may have enqueued
        this.savePending(ops);
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Enqueue one op (persisted) and immediately try to flush the queue. */
  private enqueue(op: PendingOp): void {
    this.savePending([...this.pendingOps(), op]);
    void this.flush();
  }

  /* ----------------------------- real-time API ------------------------------ */

  /**
   * Merge-write one item locally AND to the server ledger in REAL TIME.
   * The write is queued+flushed, so a failure is retried on the next action.
   */
  persist(id: string, patch: PersistedVerdict): void {
    this.persistLocal(id, patch);
    this.enqueue({ itemId: id, patch });
  }

  /** Merge-write a single item's chosen variant only (local + server). */
  persistVariant(id: string, variant: number): void {
    this.persist(id, { variant });
  }

  /**
   * Real-time note persistence, debounced (default 600ms after the last
   * keystroke). An empty note clears the stored note.
   */
  persistNoteDebounced(id: string, note: string): void {
    const t = this.noteTimers.get(id);
    if (t) clearTimeout(t);
    this.noteTimers.set(
      id,
      setTimeout(() => {
        this.noteTimers.delete(id);
        this.persist(id, { note: note.trim() });
      }, this.noteDebounceMs),
    );
  }

  /** Cancel a pending debounced note write (e.g. a verdict is about to carry it). */
  cancelPendingNote(id: string): void {
    const t = this.noteTimers.get(id);
    if (t) {
      clearTimeout(t);
      this.noteTimers.delete(id);
    }
  }

  /** Undo: delete one item's verdict locally AND on the server (verdict: null). */
  remove(id: string): void {
    this.cancelPendingNote(id);
    this.removeLocal(id);
    this.enqueue({ itemId: id, patch: null });
  }

  /* ------------------------------ server read ------------------------------- */

  /**
   * Read the durable server verdict map. Flushes the pending queue first and
   * replays any STILL-pending ops over the result, so an offline verdict is
   * never clobbered by hydration. Returns null if the server is unavailable.
   */
  async serverLoad(): Promise<VerdictMap | null> {
    await this.flush();
    let map: VerdictMap | null = null;
    try {
      const r = await fetch(`${this.stateUrl}?target=${encodeURIComponent(this.target)}`, {
        cache: "no-store",
      });
      if (r.ok) {
        const d = (await r.json()) as { ok?: boolean; verdicts?: VerdictMap };
        if (d?.ok && d.verdicts) map = d.verdicts;
      }
    } catch {
      map = null;
    }
    if (!map) return null;
    // Replay unflushed local ops on top - local intent wins until delivered.
    for (const op of this.pendingOps()) {
      if (op.patch === null) delete map[op.itemId];
      else map[op.itemId] = { ...map[op.itemId], ...op.patch };
    }
    return map;
  }
}

/** Convenience factory (equivalent to `new QAStore(opts)`). */
export function createQAStore(opts: QAStoreOptions): QAStore {
  return new QAStore(opts);
}

/**
 * Read a `?target=` override from the current URL (useful for isolating E2E
 * runs from the real review bucket). Falls back to the given default.
 */
export function targetFromLocation(defaultTarget: string): string {
  try {
    if (typeof window === "undefined") return defaultTarget;
    return new URLSearchParams(window.location.search).get("target") || defaultTarget;
  } catch {
    return defaultTarget;
  }
}
