// Framework-agnostic handler factory for the QA review endpoints. Every
// handler is a plain `(req: Request) => Promise<Response>` (Web standard), so
// they mount 1:1 in Next.js route handlers, Remix, Hono, or any Node server
// that speaks fetch primitives.
//
// Endpoint semantics (the durable verdict ledger):
//   state GET  ?target=...                       -> { ok, verdicts: {itemId: {verdict,note,variant}} }
//   state POST { target, itemId, verdict, ... }  -> merge-upsert one item
//   state POST { target, itemId, verdict: null } -> invalidate that ONE item
//        (the only way to make an approved item reappear). With a
//        `revisitReason` the row is KEPT (prior verdict + note + fingerprint
//        preserved, reason recorded) so the card can tell the reviewer WHY it
//        is back; without a reason the row is deleted (undo).
//   🚨 Deliberately NO reset-all operation: the ledger is never wiped in bulk.
//   submit POST { target, results, ... }         -> insert one session snapshot
//   sessions GET ?target=&limit=                 -> list recent session summaries
//   access GET                                   -> { ok, displayName? } (auth probe)

import {
  createPostgresStorage,
  type QAReviewStorage,
  type SessionResultRow,
} from "./storage.js";
import { codenameFor } from "../shared/codename.js";

/** Result of a successful authorization. */
export interface QAAuthUser {
  /** Persisted as the session reviewer (overrides any client-sent value). */
  reviewer?: string;
  /** Returned by the access probe for UI display. */
  displayName?: string;
}

export interface QAReviewHandlerOptions {
  /**
   * Install scope - one database can serve many sites/apps; every row is
   * scoped to this value (e.g. "example-site").
   */
  site: string;
  /**
   * Auth gate, BYO: return a user to allow, null/undefined to reject (401).
   * Runs on EVERY endpoint. For an unauthenticated local tool use
   * `async () => ({})`.
   */
  authorize: (req: Request) => Promise<QAAuthUser | null | undefined>;
  /** Storage adapter. Default: Postgres via QA_REVIEW_DATABASE_URL. */
  storage?: QAReviewStorage;
}

export interface QAReviewHandlers {
  stateGET: (req: Request) => Promise<Response>;
  statePOST: (req: Request) => Promise<Response>;
  submitPOST: (req: Request) => Promise<Response>;
  sessionsGET: (req: Request) => Promise<Response>;
  accessGET: (req: Request) => Promise<Response>;
}

/** Hard sanity caps so a bad client cannot bloat the tables. */
const MAX_KEY = 200;
const MAX_TITLE = 500;
const MAX_TEXT = 4000;
const MAX_RESULTS = 200;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export function createQAReviewHandlers(opts: QAReviewHandlerOptions): QAReviewHandlers {
  const storage = opts.storage ?? createPostgresStorage();
  const site = opts.site;

  const guard = async (req: Request): Promise<QAAuthUser | null> => {
    try {
      return (await opts.authorize(req)) ?? null;
    } catch {
      return null; // fail closed
    }
  };

  return {
    async stateGET(req) {
      const user = await guard(req);
      if (!user) return json({ ok: false }, 401);

      const target = new URL(req.url).searchParams.get("target") || "";
      if (!target) return json({ ok: false, error: "Missing target." }, 400);

      try {
        const verdicts = await storage.getState(site, target);
        // Attach the deterministic codename per item so agents/humans can
        // reference items by name ("I'm QA-ing red-apple").
        for (const [itemId, v] of Object.entries(verdicts)) {
          v.codename = codenameFor(target, itemId);
        }
        return json({ ok: true, verdicts });
      } catch (e) {
        console.error("[qa-review/state] read failed:", e);
        return json({ ok: false, error: "Database read failed." }, 500);
      }
    },

    async statePOST(req) {
      const user = await guard(req);
      if (!user) return json({ ok: false }, 401);

      let body: {
        target?: string;
        itemId?: string;
        verdict?: string | null;
        note?: string;
        variant?: number;
        fp?: string;
        approvedDevices?: unknown;
        revisitReason?: string;
      };
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: "Invalid JSON." }, 400);
      }
      const target = typeof body.target === "string" ? body.target.slice(0, MAX_KEY) : "";
      const itemId = typeof body.itemId === "string" ? body.itemId.slice(0, MAX_KEY) : "";
      if (!target || !itemId) {
        return json({ ok: false, error: "Missing target or itemId." }, 400);
      }

      try {
        // verdict === null -> invalidate this single item. A revisitReason
        // keeps the row with re-queue context (0.3.3); no reason = plain
        // delete (undo semantics).
        if (body.verdict === null) {
          const reason =
            typeof body.revisitReason === "string" ? body.revisitReason.trim().slice(0, 500) : "";
          if (reason) {
            await storage.invalidateState(site, target, itemId, reason);
            return json({ ok: true, invalidated: itemId, revisitReason: reason });
          }
          await storage.deleteState(site, target, itemId);
          return json({ ok: true, deleted: itemId });
        }

        const patch: {
          verdict?: string;
          note?: string | null;
          variant?: number | null;
          fp?: string | null;
          approvedDevices?: string[] | null;
        } = {};
        if (body.verdict !== undefined) {
          if (body.verdict !== "approve" && body.verdict !== "reject") {
            return json({ ok: false, error: "Invalid verdict." }, 400);
          }
          patch.verdict = body.verdict;
        }
        if (body.note !== undefined) patch.note = String(body.note).slice(0, MAX_TEXT) || null;
        if (body.variant !== undefined)
          patch.variant = typeof body.variant === "number" ? body.variant : null;
        if (body.fp !== undefined) patch.fp = String(body.fp).slice(0, 128) || null;
        if (body.approvedDevices !== undefined) {
          patch.approvedDevices = Array.isArray(body.approvedDevices)
            ? body.approvedDevices.filter((d): d is string => d === "pc" || d === "mobile")
            : null;
        }

        await storage.upsertState(site, target, itemId, patch);
        return json({ ok: true });
      } catch (e) {
        console.error("[qa-review/state] write failed:", e);
        return json({ ok: false, error: "Database write failed." }, 500);
      }
    },

    async submitPOST(req) {
      const user = await guard(req);
      if (!user) return json({ ok: false, error: "Not authorized." }, 401);

      let body: {
        target?: string;
        reviewer?: string;
        results?: unknown[];
      };
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: "Invalid JSON body." }, 400);
      }
      if (!body || typeof body.target !== "string" || !body.target || !Array.isArray(body.results)) {
        return json({ ok: false, error: "Missing target or results." }, 400);
      }
      if (body.results.length > MAX_RESULTS) {
        return json({ ok: false, error: "Too many results." }, 400);
      }

      // Normalize/validate per-item rows; never trust client-side shapes blindly.
      const results: SessionResultRow[] = body.results.map((raw) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        return {
          id: String(r.id ?? "").slice(0, MAX_KEY),
          title: String(r.title ?? "").slice(0, MAX_TITLE),
          verdict: r.verdict === "approve" || r.verdict === "reject" ? r.verdict : ("skipped" as const),
          note: typeof r.note === "string" && r.note ? r.note.slice(0, MAX_TEXT) : undefined,
          variant: typeof r.variant === "number" ? r.variant : undefined,
        };
      });

      try {
        const { id } = await storage.insertSession(site, {
          target: body.target.slice(0, MAX_KEY),
          // Reviewer from the VERIFIED auth result wins over the client payload.
          reviewer:
            user.reviewer ?? (typeof body.reviewer === "string" ? body.reviewer.slice(0, MAX_TITLE) : null),
          approved: results.filter((r) => r.verdict === "approve").length,
          rejected: results.filter((r) => r.verdict === "reject").length,
          total: results.length,
          results,
        });
        return json({ ok: true, reviewId: id });
      } catch (e) {
        console.error("[qa-review/submit] DB write failed:", e);
        return json({ ok: false, error: "Database write failed - use Copy JSON as fallback." }, 500);
      }
    },

    async sessionsGET(req) {
      const user = await guard(req);
      if (!user) return json({ ok: false, sessions: [] }, 401);

      const url = new URL(req.url);
      const target = url.searchParams.get("target") || undefined;
      const limitRaw = Number(url.searchParams.get("limit"));
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;

      try {
        const sessions = await storage.listSessions(site, target, limit);
        return json({ ok: true, sessions });
      } catch (e) {
        console.error("[qa-review/sessions] read failed:", e);
        return json({ ok: false, error: "Read failed.", sessions: [] }, 500);
      }
    },

    async accessGET(req) {
      const user = await guard(req);
      if (!user) return json({ ok: false }, 401);
      return json({ ok: true, displayName: user.displayName });
    },
  };
}
