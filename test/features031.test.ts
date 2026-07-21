// 0.3.1 refinements: journey loading indicator, device-approve toggle (with
// real-time unset persistence), auto-bubble on viewport switch (hysteresis),
// pick-mode multi-select semantics, and instant tooltips.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { journeyFinishView } from "../src/client/journey.js";
import { toggleDevice, isFullyApproved } from "../src/client/device.js";
import {
  nextMinimized,
  pickedElementRef,
  shouldExitPickMode,
  type BubbleEvent,
} from "../src/client/QAReviewOverlay.js";
import { QA_STYLES } from "../src/client/styles.js";
import { QAStore } from "../src/client/store.js";

/* --------------------- 1. journey loading indicator ------------------------ */

describe("journey loading indicator", () => {
  it("a journey finish that is not complete ALWAYS shows the loading view (never blank)", () => {
    expect(journeyFinishView(true, false)).toBe("loading"); // counts fetching OR nav in flight
    expect(journeyFinishView(true, true)).toBe("complete");
    expect(journeyFinishView(false, false)).toBe("standard");
  });

  it("stylesheet ships the visible loading card + spinner", () => {
    expect(QA_STYLES).toContain(".qar-loading-card");
    expect(QA_STYLES).toContain(".qar-spinner");
    expect(QA_STYLES).toContain("qar-spin");
  });
});

/* ----------------------- 2. device approve toggle -------------------------- */

describe("device approve toggle", () => {
  it("clicking an unapproved device approves it", () => {
    expect(toggleDevice([], "pc")).toEqual({ devices: ["pc"], action: "approve" });
    expect(toggleDevice(["pc"], "mobile")).toEqual({ devices: ["pc", "mobile"], action: "approve" });
  });

  it("clicking an approved device UNSETS it", () => {
    expect(toggleDevice(["pc", "mobile"], "mobile")).toEqual({ devices: ["pc"], action: "unset" });
    expect(toggleDevice(["pc"], "pc")).toEqual({ devices: [], action: "unset" });
  });

  it("unsetting a device drops the item out of full approval", () => {
    const { devices } = toggleDevice(["pc", "mobile"], "mobile");
    expect(isFullyApproved({ approvedDevices: devices }, ["pc", "mobile"])).toBe(false);
  });

  it("unset persists in REAL TIME: delete-then-rewrite ops reach the server in order", async () => {
    const m = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
      },
    } as unknown as Window);
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    try {
      const s = new QAStore({ target: "t" });
      // The overlay's unset-on-fully-approved path: clear the row, then
      // re-write the remaining device approvals + retained fields.
      s.remove("hero");
      s.persist("hero", { approvedDevices: ["pc"], note: "kept", fp: "cafe1234" });
      await new Promise((r) => setTimeout(r, 0));
      expect(bodies).toEqual([
        { target: "t", itemId: "hero", verdict: null },
        { target: "t", itemId: "hero", approvedDevices: ["pc"], note: "kept", fp: "cafe1234" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/* ------------------ 3. auto-bubble on viewport switch ---------------------- */

describe("auto-bubble hysteresis", () => {
  const run = (start: boolean, events: BubbleEvent[]) =>
    events.reduce((state, ev) => nextMinimized(state, ev), start);

  it("viewport switch to mobile minimizes; back to desktop restores", () => {
    expect(run(false, [{ type: "viewport", mobile: true }])).toBe(true);
    expect(
      run(false, [
        { type: "viewport", mobile: true },
        { type: "viewport", mobile: false },
      ]),
    ).toBe(false);
  });

  it("manual action wins over the auto state until the NEXT viewport switch", () => {
    // auto-minimized on mobile, user manually restores -> stays restored
    expect(
      run(false, [
        { type: "viewport", mobile: true },
        { type: "manual", minimized: false },
      ]),
    ).toBe(false);
    // ...until the next switch re-applies the auto behavior
    expect(
      run(false, [
        { type: "viewport", mobile: true },
        { type: "manual", minimized: false },
        { type: "viewport", mobile: false },
        { type: "viewport", mobile: true },
      ]),
    ).toBe(true);
    // manual minimize on desktop holds until a viewport change restores
    expect(
      run(false, [
        { type: "manual", minimized: true },
        { type: "viewport", mobile: false },
      ]),
    ).toBe(false);
  });
});

/* ------------------- 5. pick-mode multi-select semantics ------------------- */

describe("element-pick multi-select", () => {
  it("left click picks and exits; right click picks and stays", () => {
    expect(shouldExitPickMode("left")).toBe(true);
    expect(shouldExitPickMode("right")).toBe(false);
  });

  it("picked reference text: normalized label, truncated, tag fallback", () => {
    expect(pickedElementRef("  Buy   now ", "BUTTON")).toBe(" «Buy now» ");
    expect(pickedElementRef("", "SECTION")).toBe(" «section» ");
    expect(pickedElementRef("x".repeat(80), "P")).toBe(` «${"x".repeat(48)}» `);
  });
});

/* --------------------------- 6. instant tooltips --------------------------- */

describe("instant tooltips", () => {
  it("stylesheet ships a zero-delay [data-qatip] hover tooltip", () => {
    expect(QA_STYLES).toContain("[data-qatip]:hover::after");
    expect(QA_STYLES).toContain("content:attr(data-qatip)");
  });
});
