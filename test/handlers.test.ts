import { describe, expect, it } from "vitest";
import { createQAReviewHandlers } from "../src/server/handlers.js";
import type {
  NewSession,
  QAReviewStorage,
  SessionSummary,
  StoredVerdictMap,
  VerdictPatch,
} from "../src/server/storage.js";

/** In-memory storage double implementing the full contract. */
function fakeStorage() {
  const state = new Map<string, StoredVerdictMap>(); // "site|target" -> map
  const sessions: Array<NewSession & { id: string; site: string; createdAt: string }> = [];
  const key = (site: string, target: string) => `${site}|${target}`;

  const storage: QAReviewStorage = {
    async getState(site, target) {
      return structuredClone(state.get(key(site, target)) ?? {});
    },
    async upsertState(site, target, itemId, patch: VerdictPatch) {
      const bucket = state.get(key(site, target)) ?? {};
      const prev = bucket[itemId] ?? {};
      bucket[itemId] = {
        verdict: patch.verdict !== undefined ? patch.verdict : prev.verdict,
        note: patch.note !== undefined ? (patch.note ?? undefined) : prev.note,
        variant: patch.variant !== undefined ? (patch.variant ?? undefined) : prev.variant,
        fp: patch.fp !== undefined ? (patch.fp ?? undefined) : prev.fp,
        approvedDevices:
          patch.approvedDevices !== undefined ? (patch.approvedDevices ?? undefined) : prev.approvedDevices,
      };
      state.set(key(site, target), bucket);
    },
    async deleteState(site, target, itemId) {
      const bucket = state.get(key(site, target));
      if (bucket) delete bucket[itemId];
    },
    async insertSession(site, session) {
      const id = `s${sessions.length + 1}`;
      sessions.push({ ...session, id, site, createdAt: new Date().toISOString() });
      return { id };
    },
    async listSessions(site, target, limit = 100) {
      return sessions
        .filter((s) => s.site === site && (!target || s.target === target))
        .slice(-limit)
        .reverse()
        .map(
          (s): SessionSummary => ({
            id: s.id,
            site: s.site,
            target: s.target,
            reviewer: s.reviewer,
            approved: s.approved,
            rejected: s.rejected,
            total: s.total,
            createdAt: s.createdAt,
          }),
        );
    },
  };
  return { storage, state, sessions };
}

const allow = async () => ({ reviewer: "Reviewer One", displayName: "Reviewer One" });
const deny = async () => null;

const post = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const BASE = "https://example.com/api/qa";

describe("auth gate", () => {
  it("rejects every endpoint with 401 when authorize returns null", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: deny, storage });
    expect((await h.stateGET(new Request(`${BASE}/state?target=t`))).status).toBe(401);
    expect((await h.statePOST(post(`${BASE}/state`, { target: "t", itemId: "i" }))).status).toBe(401);
    expect((await h.submitPOST(post(`${BASE}/submit`, { target: "t", results: [] }))).status).toBe(401);
    expect((await h.sessionsGET(new Request(`${BASE}/sessions`))).status).toBe(401);
    expect((await h.accessGET(new Request(`${BASE}/access`))).status).toBe(401);
  });

  it("fails closed when authorize throws", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({
      site: "example",
      authorize: async () => {
        throw new Error("boom");
      },
      storage,
    });
    expect((await h.accessGET(new Request(`${BASE}/access`))).status).toBe(401);
  });

  it("access probe returns displayName", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    const res = await h.accessGET(new Request(`${BASE}/access`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, displayName: "Reviewer One" });
  });
});

describe("state ledger", () => {
  it("GET requires target", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    expect((await h.stateGET(new Request(`${BASE}/state`))).status).toBe(400);
  });

  it("merge-upserts a verdict then reads it back", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });

    let res = await h.statePOST(
      post(`${BASE}/state`, { target: "page:/", itemId: "hero", verdict: "approve", variant: 2 }),
    );
    expect(res.status).toBe(200);

    // Patch only the note - verdict and variant must survive the merge.
    res = await h.statePOST(post(`${BASE}/state`, { target: "page:/", itemId: "hero", note: "nice" }));
    expect(res.status).toBe(200);

    res = await h.stateGET(new Request(`${BASE}/state?target=${encodeURIComponent("page:/")}`));
    const data = await res.json();
    // (GET also attaches a computed codename - covered in the 0.3.0 suite.)
    expect(data.verdicts.hero).toMatchObject({ verdict: "approve", variant: 2, note: "nice" });
  });

  it("verdict:null deletes exactly that item (single-item invalidation)", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    await h.statePOST(post(`${BASE}/state`, { target: "t", itemId: "a", verdict: "approve" }));
    await h.statePOST(post(`${BASE}/state`, { target: "t", itemId: "b", verdict: "reject" }));

    const res = await h.statePOST(post(`${BASE}/state`, { target: "t", itemId: "a", verdict: null }));
    expect(await res.json()).toEqual({ ok: true, deleted: "a" });

    const read = await (await h.stateGET(new Request(`${BASE}/state?target=t`))).json();
    expect(read.verdicts.a).toBeUndefined();
    expect(read.verdicts.b).toMatchObject({ verdict: "reject" });
  });

  it("rejects invalid verdict values", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    const res = await h.statePOST(post(`${BASE}/state`, { target: "t", itemId: "a", verdict: "maybe" }));
    expect(res.status).toBe(400);
  });

  it("site-scopes rows (multi-install isolation)", async () => {
    const { storage } = fakeStorage();
    const h1 = createQAReviewHandlers({ site: "site-one", authorize: allow, storage });
    const h2 = createQAReviewHandlers({ site: "site-two", authorize: allow, storage });
    await h1.statePOST(post(`${BASE}/state`, { target: "t", itemId: "x", verdict: "approve" }));
    const read2 = await (await h2.stateGET(new Request(`${BASE}/state?target=t`))).json();
    expect(read2.verdicts).toEqual({});
  });
});

describe("session submit", () => {
  it("normalizes rows, counts verdicts, and uses the verified reviewer", async () => {
    const { storage, sessions } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    const res = await h.submitPOST(
      post(`${BASE}/submit`, {
        target: "page:/",
        reviewer: "Client-Claimed Name",
        results: [
          { id: "a", title: "A", verdict: "approve", variant: 1 },
          { id: "b", title: "B", verdict: "reject", note: "off-brand" },
          { id: "c", title: "C", verdict: "hacked" }, // -> skipped
        ],
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].approved).toBe(1);
    expect(sessions[0].rejected).toBe(1);
    expect(sessions[0].total).toBe(3);
    expect(sessions[0].reviewer).toBe("Reviewer One"); // auth wins over payload
    expect(sessions[0].results[2].verdict).toBe("skipped");
  });

  it("caps oversized submissions", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    const results = Array.from({ length: 201 }, (_, i) => ({ id: `i${i}`, title: "t", verdict: "approve" }));
    const res = await h.submitPOST(post(`${BASE}/submit`, { target: "t", results }));
    expect(res.status).toBe(400);
  });

  it("lists recent sessions via sessionsGET", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    await h.submitPOST(post(`${BASE}/submit`, { target: "t", results: [] }));
    const data = await (await h.sessionsGET(new Request(`${BASE}/sessions?target=t`))).json();
    expect(data.ok).toBe(true);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].target).toBe("t");
  });
});

describe("0.3.0 state fields (fingerprint + device approvals + codenames)", () => {
  it("fp and approvedDevices round-trip through POST/GET", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    await h.statePOST(
      post(`${BASE}/state`, { target: "t", itemId: "hero", approvedDevices: ["pc"], fp: "cafe1234" }),
    );
    await h.statePOST(
      post(`${BASE}/state`, { target: "t", itemId: "hero", verdict: "approve", approvedDevices: ["pc", "mobile"] }),
    );
    const data = await (await h.stateGET(new Request(`${BASE}/state?target=t`))).json();
    expect(data.verdicts.hero.fp).toBe("cafe1234"); // merged, not clobbered
    expect(data.verdicts.hero.approvedDevices).toEqual(["pc", "mobile"]);
    expect(data.verdicts.hero.verdict).toBe("approve");
  });

  it("approvedDevices values outside pc/mobile are filtered", async () => {
    const { storage, state } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    await h.statePOST(
      post(`${BASE}/state`, { target: "t", itemId: "x", approvedDevices: ["pc", "tv", 42] }),
    );
    expect(state.get("example|t")?.x.approvedDevices).toEqual(["pc"]);
  });

  it("state GET attaches the deterministic codename per item", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    await h.statePOST(post(`${BASE}/state`, { target: "t", itemId: "hero", verdict: "approve" }));
    const data = await (await h.stateGET(new Request(`${BASE}/state?target=t`))).json();
    expect(data.verdicts.hero.codename).toMatch(/^[a-z]+-[a-z0-9]+$/);
    // deterministic: same (target, itemId) -> same codename on every read
    const again = await (await h.stateGET(new Request(`${BASE}/state?target=t`))).json();
    expect(again.verdicts.hero.codename).toBe(data.verdicts.hero.codename);
  });
});
