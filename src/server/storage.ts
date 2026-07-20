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
}

/** item id -> stored verdict. */
export type StoredVerdictMap = Record<string, StoredVerdict>;

export interface VerdictPatch {
  verdict?: string;
  note?: string | null;
  variant?: number | null;
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
        { item_id: string; verdict: string | null; note: string | null; variant: number | null }[]
      >`
        SELECT item_id, verdict, note, variant
        FROM qa_review_state
        WHERE site = ${site} AND target = ${target}
      `;
      const map: StoredVerdictMap = {};
      for (const r of rows) {
        map[r.item_id] = {
          verdict: r.verdict ?? undefined,
          note: r.note ?? undefined,
          variant: r.variant ?? undefined,
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
      await db`
        INSERT INTO qa_review_state (site, target, item_id, verdict, note, variant, updated_at)
        VALUES (${site}, ${target}, ${itemId}, ${verdict}, ${note}, ${variant}, now())
        ON CONFLICT (site, target, item_id) DO UPDATE SET
          verdict = CASE WHEN ${hasVerdict} THEN EXCLUDED.verdict ELSE qa_review_state.verdict END,
          note = CASE WHEN ${hasNote} THEN EXCLUDED.note ELSE qa_review_state.note END,
          variant = CASE WHEN ${hasVariant} THEN EXCLUDED.variant ELSE qa_review_state.variant END,
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
