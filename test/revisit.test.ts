// 0.3.3: re-queue context. An invalidated item must tell the reviewer WHY it
// is back and what they said last time - a reviewer paused a review because a
// re-queued card carried no context at all.
import { describe, expect, it } from "vitest";
import { describeRevisit } from "../src/client/revisit.js";
import { countUnverdicted } from "../src/client/journey.js";
import { createQAReviewHandlers } from "../src/server/handlers.js";
import type {
  NewSession,
  QAReviewStorage,
  SessionSummary,
  StoredVerdictMap,
  VerdictPatch,
} from "../src/server/storage.js";

/* --------------------------- display logic (card) -------------------------- */

describe("describeRevisit (card display)", () => {
  it("reason headlines prominently + prior verdict, note handed back separately", () => {
    const d = describeRevisit(
      { reason: "over-bolding trimmed to one phrase", prevVerdict: "reject", prevNote: "too much bold" },
      "changed",
    );
    expect(d?.headline).toBe("Back for review: over-bolding trimmed to one phrase");
    // 0.4.0: the note is NOT inlined here - the card renders it collapsed, and
    // it also sits in the textarea below, so inlining made the reviewer read
    // their own note up to three times per card.
    expect(d?.prior).toBe("Your last verdict: reject");
    expect(d?.priorNote).toBe("too much bold");
    expect(d?.notAltered).toBe(false);
  });

  it("no reason + CHANGED fingerprint -> generic changed headline", () => {
    const d = describeRevisit({ prevVerdict: "approve" }, "changed");
    expect(d?.headline).toBe("Content changed since your last review.");
    expect(d?.prior).toBe("Your last verdict: approve");
  });

  it("prior REJECT + UNCHANGED fingerprint -> NOT-ALTERED badge (even with a reason)", () => {
    const withReason = describeRevisit(
      { reason: "please reassess", prevVerdict: "reject", prevNote: "bold missing" },
      "unchanged",
    );
    expect(withReason?.notAltered).toBe(true);
    expect(withReason?.headline).toBe("Back for review: please reassess");
    const noReason = describeRevisit({ prevVerdict: "reject" }, "unchanged");
    expect(noReason?.notAltered).toBe(true);
  });

  it("reason on a never-reviewed item shows the reason alone", () => {
    const d = describeRevisit({ reason: "new acceptance criteria" }, null);
    expect(d).toEqual({
      headline: "Back for review: new acceptance criteria",
      prior: null,
      priorNote: null,
      notAltered: false,
    });
  });

  // 0.4.0: walking back over your own verdicts inside ONE pass is navigation,
  // not a revisit. Rejecting an item, moving on, then pressing Prev used to say
  // "NOT ALTERED since your rejection" - true, and useless, because nobody had
  // been given the chance to alter anything yet.
  it("same round -> nothing at all, even for a reject on unchanged content", () => {
    expect(describeRevisit({ prevVerdict: "reject", prevRound: 2 }, "unchanged", 2)).toBeNull();
    expect(describeRevisit({ reason: "please reassess", prevRound: 2 }, "changed", 2)).toBeNull();
  });

  it("a LATER round still speaks, and an unknown round on either side does too", () => {
    expect(describeRevisit({ prevVerdict: "reject", prevRound: 1 }, "unchanged", 2)?.notAltered).toBe(true);
    // pre-0.4.0 rows carry no round - those verdicts are genuinely from earlier
    expect(describeRevisit({ prevVerdict: "reject" }, "unchanged", 2)?.notAltered).toBe(true);
    expect(describeRevisit({ prevVerdict: "reject", prevRound: 2 }, "unchanged")?.notAltered).toBe(true);
  });

  it("null when there is nothing to say", () => {
    expect(describeRevisit(undefined, "changed")).toBeNull();
    expect(describeRevisit({}, null)).toBeNull();
  });
});

/* ------------------------- endpoint round-trip ----------------------------- */

function fakeStorage() {
  const state = new Map<string, StoredVerdictMap>();
  const key = (site: string, target: string) => `${site}|${target}`;
  const storage: QAReviewStorage = {
    async getState(site, target) {
      return structuredClone(state.get(key(site, target)) ?? {});
    },
    async upsertState(site, target, itemId, patch: VerdictPatch) {
      const bucket = state.get(key(site, target)) ?? {};
      const prev = bucket[itemId] ?? {};
      const hasVerdict = patch.verdict !== undefined;
      bucket[itemId] = {
        verdict: hasVerdict ? patch.verdict : prev.verdict,
        note: patch.note !== undefined ? (patch.note ?? undefined) : prev.note,
        variant: patch.variant !== undefined ? (patch.variant ?? undefined) : prev.variant,
        fp: patch.fp !== undefined ? (patch.fp ?? undefined) : prev.fp,
        approvedDevices:
          patch.approvedDevices !== undefined ? (patch.approvedDevices ?? undefined) : prev.approvedDevices,
        revisitReason: hasVerdict ? undefined : prev.revisitReason,
        prevVerdict: hasVerdict ? undefined : prev.prevVerdict,
      };
      state.set(key(site, target), bucket);
    },
    async deleteState(site, target, itemId) {
      const bucket = state.get(key(site, target));
      if (bucket) delete bucket[itemId];
    },
    async invalidateState(site, target, itemId, revisitReason) {
      const bucket = state.get(key(site, target)) ?? {};
      const prev = bucket[itemId] ?? {};
      bucket[itemId] = {
        note: prev.note,
        variant: prev.variant,
        fp: prev.fp,
        prevVerdict: prev.verdict ?? prev.prevVerdict,
        revisitReason,
      };
      state.set(key(site, target), bucket);
    },
    async insertSession(_site: string, _s: NewSession) {
      return { id: "s1" };
    },
    async listSessions(): Promise<SessionSummary[]> {
      return [];
    },
  };
  return { storage, state };
}

const allow = async () => ({});
const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const BASE = "https://example.com/api/qa";

describe("invalidation endpoint with revisitReason", () => {
  it("keeps the row: prior verdict + note + fp preserved, reason stored, verdict cleared", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    await h.statePOST(
      post(`${BASE}/state`, { target: "t", itemId: "hero", verdict: "reject", note: "too bold", fp: "aa11" }),
    );
    const res = await h.statePOST(
      post(`${BASE}/state`, { target: "t", itemId: "hero", verdict: null, revisitReason: "bolding trimmed" }),
    );
    expect(await res.json()).toEqual({ ok: true, invalidated: "hero", revisitReason: "bolding trimmed" });

    const read = await (await h.stateGET(new Request(`${BASE}/state?target=t`))).json();
    expect(read.verdicts.hero).toMatchObject({
      revisitReason: "bolding trimmed",
      prevVerdict: "reject",
      note: "too bold",
      fp: "aa11",
    });
    expect(read.verdicts.hero.verdict).toBeUndefined(); // re-queued
  });

  it("verdict:null WITHOUT a reason still hard-deletes (undo semantics unchanged)", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    await h.statePOST(post(`${BASE}/state`, { target: "t", itemId: "x", verdict: "approve" }));
    const res = await h.statePOST(post(`${BASE}/state`, { target: "t", itemId: "x", verdict: null }));
    expect(await res.json()).toEqual({ ok: true, deleted: "x" });
    const read = await (await h.stateGET(new Request(`${BASE}/state?target=t`))).json();
    expect(read.verdicts.x).toBeUndefined();
  });

  it("a NEW verdict on the re-queued item consumes the revisit context", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    await h.statePOST(post(`${BASE}/state`, { target: "t", itemId: "hero", verdict: "reject" }));
    await h.statePOST(
      post(`${BASE}/state`, { target: "t", itemId: "hero", verdict: null, revisitReason: "reworked" }),
    );
    await h.statePOST(post(`${BASE}/state`, { target: "t", itemId: "hero", verdict: "approve" }));
    const read = await (await h.stateGET(new Request(`${BASE}/state?target=t`))).json();
    expect(read.verdicts.hero.verdict).toBe("approve");
    expect(read.verdicts.hero.revisitReason).toBeUndefined();
    expect(read.verdicts.hero.prevVerdict).toBeUndefined();
  });

  it("a reason can be attached to a never-reviewed item (reassess guidance)", async () => {
    const { storage } = fakeStorage();
    const h = createQAReviewHandlers({ site: "example", authorize: allow, storage });
    await h.statePOST(
      post(`${BASE}/state`, { target: "t", itemId: "fresh", verdict: null, revisitReason: "new criteria" }),
    );
    const read = await (await h.stateGET(new Request(`${BASE}/state?target=t`))).json();
    expect(read.verdicts.fresh).toMatchObject({ revisitReason: "new criteria" });
  });

  it("an invalidated item counts as navigation-pending again (re-enters the journey)", () => {
    expect(
      countUnverdicted(["hero"], { hero: { revisitReason: "reworked", prevVerdict: "reject", fp: "aa11" } }),
    ).toBe(1);
  });
});
