"use client";

// Client-side verdict persistence: localStorage as a fast cache for instant
// paint, plus a best-effort mirror to the durable server ledger (the state
// endpoint). A server failure silently degrades to localStorage-only behavior
// (still fully functional).
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

export interface QAStoreOptions {
  /** Review bucket this store reads/writes (e.g. "example-site:/pricing"). */
  target: string;
  /** State endpoint URL. Default "/api/qa/state". */
  stateUrl?: string;
  /** localStorage key builder. Default: target-suffixed generic key. */
  storageKey?: (target: string) => string;
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

  constructor(opts: QAStoreOptions) {
    this.target = opts.target;
    this.stateUrl = opts.stateUrl ?? DEFAULT_STATE_URL;
    this.key = (opts.storageKey ?? defaultStorageKey)(opts.target);
  }

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

  /** Merge-write one item locally AND fire-and-forget to the server ledger. */
  persist(id: string, patch: PersistedVerdict): void {
    this.persistLocal(id, patch);
    this.serverPersist(id, patch);
  }

  /** Merge-write a single item's chosen variant only (local + server). */
  persistVariant(id: string, variant: number): void {
    this.persist(id, { variant });
  }

  /** Read the durable server verdict map. Returns null if unavailable. */
  async serverLoad(): Promise<VerdictMap | null> {
    try {
      const r = await fetch(`${this.stateUrl}?target=${encodeURIComponent(this.target)}`, {
        cache: "no-store",
      });
      if (!r.ok) return null;
      const d = (await r.json()) as { ok?: boolean; verdicts?: VerdictMap };
      return d?.ok && d.verdicts ? d.verdicts : null;
    } catch {
      return null;
    }
  }

  /** Fire-and-forget: persist one item's verdict/note/variant to the server. */
  serverPersist(id: string, patch: PersistedVerdict): void {
    try {
      void fetch(this.stateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: this.target, itemId: id, ...patch }),
      });
    } catch {
      /* best-effort */
    }
  }

  /** Undo: delete one item's verdict locally AND on the server (verdict: null). */
  remove(id: string): void {
    this.removeLocal(id);
    try {
      void fetch(this.stateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: this.target, itemId: id, verdict: null }),
      });
    } catch {
      /* best-effort */
    }
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
