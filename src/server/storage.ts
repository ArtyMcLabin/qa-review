// Storage layer for the QA review server handlers.
//
// The Postgres adapter SELF-PROVISIONS its own tables on first use via a tiny
// versioned migration runner (drizzle-style `__migrations` bookkeeping table,
// all names prefixed `qa_review_`), so consumers never hand-write migrations.
// A `site` scope column lets ONE database serve many installs.

import postgres from "postgres";

export interface StoredVerdict {
  verdict?: string;
  note?: string;
  variant?: number;
  /** Content fingerprint at verdict time (NOT-ALTERED poka-yoke). */
  fp?: string;
  /** Per-device approvals ("pc"/"mobile") for device-split items. */
  approvedDevices?: string[];
  /** Deterministic two-word codename (computed, not stored). */
  codename?: string;
  /** Why the item was re-queued (set by the invalidation call). */
  revisitReason?: string;
  /** Verdict that was in effect before the invalidation. */
  prevVerdict?: string;
}

/** item id -> stored verdict. */
export type StoredVerdictMap = Record<string, StoredVerdict>;

export interface VerdictPatch {
  verdict?: string;
  note?: string | null;
  variant?: number | null;
  fp?: string | null;
  approvedDevices?: string[] | null;
}

export interface SessionResultRow {
  id: string;
  title: string;
  verdict: "approve" | "reject" | "skipped";
  note?: string;
  variant?: number;
}

export interface NewSession {
  target: string;
  reviewer: string | null;
  approved: number;
  rejected: number;
  total: number;
  results: SessionResultRow[];
}

export interface SessionSummary {
  id: string;
  site: string;
  target: string;
  reviewer: string | null;
  approved: number;
  rejected: number;
  total: number;
  createdAt: string;
}

/** Pluggable storage contract (the Postgres adapter is the shipped default). */
export interface QAReviewStorage {
  getState(site: string, target: string): Promise<StoredVerdictMap>;
  upsertState(site: string, target: string, itemId: string, patch: VerdictPatch): Promise<void>;
  deleteState(site: string, target: string, itemId: string): Promise<void>;
  /**
   * Invalidate WITH context (0.3.3): clear the verdict + device approvals so
   * the item re-queues, but KEEP the row - prior verdict moves to
   * prev_verdict, the note and fingerprint stay, and revisit_reason records
   * why it is back. (Plain deleteState remains the no-context undo.)
   */
  invalidateState(site: string, target: string, itemId: string, revisitReason: string): Promise<void>;
  insertSession(site: string, session: NewSession): Promise<{ id: string }>;
  listSessions(site: string, target?: string, limit?: number): Promise<SessionSummary[]>;
}

export interface PostgresStorageOptions {
  /** Postgres connection string. Default: process.env.QA_REVIEW_DATABASE_URL. */
  databaseUrl?: string;
  /** Max pool size (serverless-friendly default: 1). */
  max?: number;
}

/* ------------------------- self-provisioning DDL --------------------------- */
// Append-only list; NEVER edit an applied entry - add a new one. Applied ids
// are tracked in qa_review_migrations (advisory-locked, concurrency-safe).
const MIGRATIONS: ReadonlyArray<{ id: number; ddl: string }> = [
  {
    id: 1,
    ddl: `
      CREATE TABLE IF NOT EXISTS qa_review_state (
        site text NOT NULL,
        target text NOT NULL,
        item_id text NOT NULL,
        verdict text,
        note text,
        variant integer,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (site, target, item_id)
      );
      CREATE TABLE IF NOT EXISTS qa_review_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        site text NOT NULL,
        target text NOT NULL,
        reviewer text,
        approved integer NOT NULL DEFAULT 0,
        rejected integer NOT NULL DEFAULT 0,
        total integer NOT NULL DEFAULT 0,
        results jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS qa_review_sessions_site_target_idx
        ON qa_review_sessions (site, target);
      CREATE INDEX IF NOT EXISTS qa_review_sessions_created_idx
        ON qa_review_sessions (created_at);
    `,
  },
  {
    id: 2,
    // 0.3.0: NOT-ALTERED fingerprints + device-split approvals.
    ddl: `
      ALTER TABLE qa_review_state ADD COLUMN IF NOT EXISTS fp text;
      ALTER TABLE qa_review_state ADD COLUMN IF NOT EXISTS approved_pc boolean;
      ALTER TABLE qa_review_state ADD COLUMN IF NOT EXISTS approved_mobile boolean;
    `,
  },
  {
    id: 3,
    // 0.3.3: re-queue context (revisit reason + prior verdict).
    ddl: `
      ALTER TABLE qa_review_state ADD COLUMN IF NOT EXISTS revisit_reason text;
      ALTER TABLE qa_review_state ADD COLUMN IF NOT EXISTS prev_verdict text;
    `,
  },
];

/** Arbitrary but stable advisory-lock key for provisioning. */
const PROVISION_LOCK_KEY = 727_001_337;

function sslSetting(url: string): "require" | undefined {
  if (process.env.NODE_ENV === "production") return "require";
  try {
    const host = new URL(url).hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    return isLocal ? undefined : "require";
  } catch {
    return undefined;
  }
}

/**
 * Postgres-backed storage. Lazily connects and provisions its schema exactly
 * once per process (transaction + advisory lock, so parallel cold starts on
 * serverless cannot race each other).
 */
export function createPostgresStorage(opts: PostgresStorageOptions = {}): QAReviewStorage {
  let sql: postgres.Sql | null = null;
  let provisioned: Promise<void> | null = null;

  function connect(): postgres.Sql {
    if (sql) return sql;
    const url = opts.databaseUrl ?? process.env.QA_REVIEW_DATABASE_URL;
    if (!url) {
      throw new Error(
        "qa-review: no database URL. Pass databaseUrl or set QA_REVIEW_DATABASE_URL.",
      );
    }
    sql = postgres(url, {
      max: opts.max ?? 1,
      prepare: false,
      connect_timeout: 10,
      ssl: sslSetting(url),
    });
    return sql;
  }

  function ensureProvisioned(): Promise<void> {
    if (provisioned) return provisioned;
    provisioned = (async () => {
      const db = connect();
      await db.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(${PROVISION_LOCK_KEY})`;
        await tx`
          CREATE TABLE IF NOT EXISTS qa_review_migrations (
            id integer PRIMARY KEY,
            applied_at timestamptz NOT NULL DEFAULT now()
          )
        `;
        const applied = await tx<{ id: number }[]>`SELECT id FROM qa_review_migrations`;
        const done = new Set(applied.map((r) => r.id));
        for (const m of MIGRATIONS) {
          if (done.has(m.id)) continue;
          await tx.unsafe(m.ddl);
          await tx`INSERT INTO qa_review_migrations (id) VALUES (${m.id})`;
        }
      });
    })();
    // Allow a retry on transient failure instead of caching the rejection.
    provisioned.catch(() => {
      provisioned = null;
    });
    return provisioned;
  }

  async function ready(): Promise<postgres.Sql> {
    await ensureProvisioned();
    return connect();
  }

  return {
    async getState(site, target) {
      const db = await ready();
      const rows = await db<
        {
          item_id: string;
          verdict: string | null;
          note: string | null;
          variant: number | null;
          fp: string | null;
          approved_pc: boolean | null;
          approved_mobile: boolean | null;
          revisit_reason: string | null;
          prev_verdict: string | null;
        }[]
      >`
        SELECT item_id, verdict, note, variant, fp, approved_pc, approved_mobile, revisit_reason, prev_verdict
        FROM qa_review_state
        WHERE site = ${site} AND target = ${target}
      `;
      const map: StoredVerdictMap = {};
      for (const r of rows) {
        const devices = [
          ...(r.approved_pc ? ["pc"] : []),
          ...(r.approved_mobile ? ["mobile"] : []),
        ];
        map[r.item_id] = {
          verdict: r.verdict ?? undefined,
          note: r.note ?? undefined,
          variant: r.variant ?? undefined,
          fp: r.fp ?? undefined,
          approvedDevices: devices.length ? devices : undefined,
          revisitReason: r.revisit_reason ?? undefined,
          prevVerdict: r.prev_verdict ?? undefined,
        };
      }
      return map;
    },

    async upsertState(site, target, itemId, patch) {
      const db = await ready();
      // Merge-upsert: only the provided fields overwrite; absent fields keep
      // their stored value (COALESCE on excluded values via conditional set).
      const verdict = patch.verdict === undefined ? null : patch.verdict;
      const hasVerdict = patch.verdict !== undefined;
      const note = patch.note === undefined ? null : patch.note;
      const hasNote = patch.note !== undefined;
      const variant = patch.variant === undefined ? null : patch.variant;
      const hasVariant = patch.variant !== undefined;
      const fp = patch.fp === undefined ? null : patch.fp;
      const hasFp = patch.fp !== undefined;
      const hasDevices = patch.approvedDevices !== undefined;
      const approvedPc = hasDevices ? (patch.approvedDevices?.includes("pc") ?? false) : null;
      const approvedMobile = hasDevices ? (patch.approvedDevices?.includes("mobile") ?? false) : null;
      await db`
        INSERT INTO qa_review_state (site, target, item_id, verdict, note, variant, fp, approved_pc, approved_mobile, updated_at)
        VALUES (${site}, ${target}, ${itemId}, ${verdict}, ${note}, ${variant}, ${fp}, ${approvedPc}, ${approvedMobile}, now())
        ON CONFLICT (site, target, item_id) DO UPDATE SET
          verdict = CASE WHEN ${hasVerdict} THEN EXCLUDED.verdict ELSE qa_review_state.verdict END,
          note = CASE WHEN ${hasNote} THEN EXCLUDED.note ELSE qa_review_state.note END,
          variant = CASE WHEN ${hasVariant} THEN EXCLUDED.variant ELSE qa_review_state.variant END,
          fp = CASE WHEN ${hasFp} THEN EXCLUDED.fp ELSE qa_review_state.fp END,
          approved_pc = CASE WHEN ${hasDevices} THEN EXCLUDED.approved_pc ELSE qa_review_state.approved_pc END,
          approved_mobile = CASE WHEN ${hasDevices} THEN EXCLUDED.approved_mobile ELSE qa_review_state.approved_mobile END,
          revisit_reason = CASE WHEN ${hasVerdict} THEN NULL ELSE qa_review_state.revisit_reason END,
          prev_verdict = CASE WHEN ${hasVerdict} THEN NULL ELSE qa_review_state.prev_verdict END,
          updated_at = now()
      `;
    },

    async deleteState(site, target, itemId) {
      const db = await ready();
      await db`
        DELETE FROM qa_review_state
        WHERE site = ${site} AND target = ${target} AND item_id = ${itemId}
      `;
    },

    async invalidateState(site, target, itemId, revisitReason) {
      const db = await ready();
      // Keep the row: verdict -> prev_verdict, approvals cleared, note + fp
      // retained (the fingerprint anchors the NOT-ALTERED comparison), reason
      // recorded. Upsert so a reason can also be attached to a never-reviewed
      // item ("reassess this" guidance).
      await db`
        INSERT INTO qa_review_state (site, target, item_id, revisit_reason, updated_at)
        VALUES (${site}, ${target}, ${itemId}, ${revisitReason}, now())
        ON CONFLICT (site, target, item_id) DO UPDATE SET
          prev_verdict = COALESCE(qa_review_state.verdict, qa_review_state.prev_verdict),
          verdict = NULL,
          approved_pc = NULL,
          approved_mobile = NULL,
          revisit_reason = ${revisitReason},
          updated_at = now()
      `;
    },

    async insertSession(site, session) {
      const db = await ready();
      const [row] = await db<{ id: string }[]>`
        INSERT INTO qa_review_sessions (site, target, reviewer, approved, rejected, total, results)
        VALUES (
          ${site}, ${session.target}, ${session.reviewer},
          ${session.approved}, ${session.rejected}, ${session.total},
          ${db.json(session.results as unknown as postgres.JSONValue)}
        )
        RETURNING id
      `;
      return { id: row.id };
    },

    async listSessions(site, target, limit = 100) {
      const db = await ready();
      const rows = await db<
        {
          id: string;
          site: string;
          target: string;
          reviewer: string | null;
          approved: number;
          rejected: number;
          total: number;
          created_at: Date;
        }[]
      >`
        SELECT id, site, target, reviewer, approved, rejected, total, created_at
        FROM qa_review_sessions
        WHERE site = ${site} ${target ? db`AND target = ${target}` : db``}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({
        id: r.id,
        site: r.site,
        target: r.target,
        reviewer: r.reviewer,
        approved: r.approved,
        rejected: r.rejected,
        total: r.total,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      }));
    },
  };
}
