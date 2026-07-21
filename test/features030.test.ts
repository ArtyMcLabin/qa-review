// 0.3.0 feature tests: NOT-ALTERED fingerprints, codename determinism +
// resolver, device-split approval completion + grandfathering, immediate
// journey navigation (no interstitial), sub-highlight word wrapping, and the
// minimize-bubble click/drag gesture threshold.
import { describe, expect, it } from "vitest";
import {
  fingerprintStatus,
  fingerprintText,
  itemFingerprint,
  normalizeText,
} from "../src/client/fingerprint.js";
import { codenameFor, findByCodename, formatQARef } from "../src/shared/codename.js";
import {
  isFullyApproved,
  nextApprovedDevices,
  requiredDevices,
} from "../src/client/device.js";
import { resolveFinishAction, type QAJourneyPage } from "../src/client/journey.js";
import { findMatchRanges } from "../src/client/highlight.js";
import { isClickGesture } from "../src/client/QAReviewOverlay.js";

/* ------------------------ 1. NOT-ALTERED poka-yoke ------------------------- */

describe("fingerprint (NOT-ALTERED poka-yoke)", () => {
  it("normalizes whitespace so formatting churn does not count as change", () => {
    expect(normalizeText("  hello   world \n\t twice ")).toBe("hello world twice");
    expect(fingerprintText("hello   world")).toBe(fingerprintText(" hello world "));
  });

  it("is deterministic and content-sensitive", () => {
    expect(fingerprintText("the pricing card")).toBe(fingerprintText("the pricing card"));
    expect(fingerprintText("the pricing card")).not.toBe(fingerprintText("the pricing card!"));
  });

  it("task items fingerprint their question text (sub, else title)", () => {
    const doc = { querySelector: () => null } as unknown as Document;
    expect(itemFingerprint({ id: "t", title: "T", sub: "Question?" }, doc)).toBe(
      fingerprintText("Question?"),
    );
    expect(itemFingerprint({ id: "t", title: "Only title" }, doc)).toBe(
      fingerprintText("Only title"),
    );
  });

  it("anchored items hash the element innerText; missing anchor -> null (no judgement)", () => {
    const el = { innerText: "  Rendered   copy " } as unknown as HTMLElement;
    const doc = {
      querySelector: (sel: string) => (sel === "#hit" ? el : null),
    } as unknown as Document;
    expect(itemFingerprint({ id: "a", title: "A", selector: "#hit" }, doc)).toBe(
      fingerprintText("Rendered copy"),
    );
    expect(itemFingerprint({ id: "a", title: "A", selector: "#miss" }, doc)).toBeNull();
  });

  it("badge status: unchanged when hashes match, changed when they differ, null when unknown", () => {
    expect(fingerprintStatus("aa11", "aa11")).toBe("unchanged"); // -> NOT ALTERED badge
    expect(fingerprintStatus("aa11", "bb22")).toBe("changed"); // -> subtle changed hint
    expect(fingerprintStatus(undefined, "bb22")).toBeNull(); // no stored fp: assert nothing
    expect(fingerprintStatus("aa11", null)).toBeNull(); // anchor missing: assert nothing
  });
});

/* ------------------- 5. codenames + copy-ref + resolver -------------------- */

describe("codenames", () => {
  it("deterministic two-word adjective-noun format", () => {
    const c1 = codenameFor("site:/", "hero");
    expect(c1).toMatch(/^[a-z]+-[a-z0-9]+$/);
    expect(codenameFor("site:/", "hero")).toBe(c1); // stable across calls
  });

  it("different items get (almost always) different codenames", () => {
    const names = new Set(
      ["hero", "video", "pillars", "team", "faq", "cta", "comps", "gallery"].map((id) =>
        codenameFor("site:/", id),
      ),
    );
    expect(names.size).toBeGreaterThan(6); // collisions possible but rare
  });

  it("findByCodename resolves spoken forms back to the item", () => {
    const entries = [
      { target: "site:/", itemId: "hero" },
      { target: "site:/", itemId: "cta" },
      { target: "site:/pricing", itemId: "hero" },
    ];
    const spoken = codenameFor("site:/", "hero").replace("-", " "); // "red apple"
    const hits = findByCodename(spoken, entries);
    expect(hits).toContainEqual({ target: "site:/", itemId: "hero" });
    expect(findByCodename("definitely not-a-codename", entries)).toEqual([]);
  });

  it("formatQARef emits the canonical copy-ref line", () => {
    const line = formatQARef("site:/", "hero", "Hero section");
    expect(line).toBe(`{ qa-ref: ${codenameFor("site:/", "hero")} | site:/ # hero | Hero section }`);
  });
});

/* --------------- 6+9. device-split approvals + grandfathering -------------- */

describe("device-split approvals", () => {
  it("defaults to PC-only", () => {
    expect(requiredDevices({})).toEqual(["pc"]);
    expect(requiredDevices({ devices: [] })).toEqual(["pc"]);
    expect(requiredDevices({ devices: ["pc", "mobile"] })).toEqual(["pc", "mobile"]);
  });

  it("GRANDFATHERING: a plain historical approval counts as FULLY approved even for multi-device items", () => {
    expect(isFullyApproved({ verdict: "approve" }, ["pc", "mobile"])).toBe(true);
    expect(isFullyApproved({ verdict: "approve" }, ["pc"])).toBe(true);
  });

  it("multi-device items complete only when EVERY required device is approved", () => {
    expect(isFullyApproved({ approvedDevices: ["pc"] }, ["pc", "mobile"])).toBe(false);
    expect(isFullyApproved({ approvedDevices: ["pc", "mobile"] }, ["pc", "mobile"])).toBe(true);
    expect(isFullyApproved({ approvedDevices: ["mobile"] }, ["pc"])).toBe(false);
  });

  it("reject and empty entries are never approved", () => {
    expect(isFullyApproved({ verdict: "reject", approvedDevices: ["pc", "mobile"] }, ["pc"])).toBe(false);
    expect(isFullyApproved(undefined, ["pc"])).toBe(false);
  });

  it("nextApprovedDevices unions idempotently", () => {
    expect(nextApprovedDevices(undefined, "pc")).toEqual(["pc"]);
    expect(nextApprovedDevices({ approvedDevices: ["pc"] }, "mobile")).toEqual(["pc", "mobile"]);
    expect(nextApprovedDevices({ approvedDevices: ["pc"] }, "pc")).toEqual(["pc"]);
  });

  it("ROUND RECOMPUTATION: pending set under device-aware semantics", () => {
    const map = {
      old: { verdict: "approve" as const }, // grandfathered -> not pending
      half: { approvedDevices: ["pc"] }, // partial -> pending
      bad: { verdict: "reject" as const }, // rejected -> pending
    };
    const items = [
      { id: "old", devices: ["pc", "mobile"] as Array<"pc" | "mobile"> },
      { id: "half", devices: ["pc", "mobile"] as Array<"pc" | "mobile"> },
      { id: "bad" },
      { id: "new" },
    ];
    const pending = items
      .filter((i) => !isFullyApproved(map[i.id as keyof typeof map], requiredDevices(i)))
      .map((i) => i.id);
    expect(pending).toEqual(["half", "bad", "new"]);
  });
});

/* ------------------- 3. immediate nav (no interstitial) -------------------- */

describe("resolveFinishAction (no page-complete interstitial)", () => {
  const PAGES: QAJourneyPage[] = [
    { path: "/", target: "s:/", itemIds: ["a"] },
    { path: "/b", target: "s:/b", itemIds: ["b1", "b2"] },
    { path: "/c", target: "s:/c", itemIds: ["c1"] },
  ];

  it("navigates IMMEDIATELY to the next pending page when one exists", () => {
    const action = resolveFinishAction(PAGES, { "s:/": 0, "s:/b": 2, "s:/c": 0 }, 0);
    expect(action).toEqual({ kind: "navigate", page: PAGES[1] });
  });

  it("journey-complete ONLY when nothing is pending anywhere else", () => {
    expect(resolveFinishAction(PAGES, { "s:/": 0, "s:/b": 0, "s:/c": 0 }, 0)).toEqual({
      kind: "journey-complete",
    });
    // pending only on the CURRENT page (round already handled it) -> complete
    expect(resolveFinishAction(PAGES, { "s:/": 3, "s:/b": 0, "s:/c": 0 }, 0)).toEqual({
      kind: "journey-complete",
    });
  });
});

/* ---------------------- 4. sub-highlight word wrapping --------------------- */

describe("sub-highlight findMatchRanges", () => {
  it("matches words case-insensitively, all occurrences", () => {
    const ranges = findMatchRanges("Quick foxes leap. QUICK FOXES rest.", ["quick foxes"]);
    expect(ranges).toEqual([
      { start: 0, end: 11 },
      { start: 18, end: 29 },
    ]);
  });

  it("multiple phrases, sorted, overlaps dropped", () => {
    const ranges = findMatchRanges("alpha beta gamma", ["beta gamma", "gamma", "alpha"]);
    expect(ranges).toEqual([
      { start: 0, end: 5 }, // alpha
      { start: 6, end: 16 }, // beta gamma (the contained "gamma" match is dropped)
    ]);
  });

  it("empty phrases and no-hit phrases yield nothing", () => {
    expect(findMatchRanges("hello", ["", "  ", "absent"])).toEqual([]);
  });
});

/* -------------------------- 7. bubble tap-vs-drag -------------------------- */

describe("minimize bubble gesture", () => {
  it("sub-threshold pointer movement counts as a click (restores the panel)", () => {
    expect(isClickGesture(0, 0)).toBe(true);
    expect(isClickGesture(3, 4)).toBe(true); // hypot 5 < 6
  });

  it("larger movement is a drag, not a click", () => {
    expect(isClickGesture(6, 0)).toBe(false);
    expect(isClickGesture(10, 10)).toBe(false);
  });
});
