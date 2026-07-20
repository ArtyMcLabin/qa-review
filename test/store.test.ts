// Real-time write-path tests for QAStore: every verdict/undo/note change must
// hit the server immediately; failures queue (write-behind, persisted) and
// retry on the next action; hydration must never clobber undelivered intent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QAStore } from "../src/client/store.js";

/* ------------------------- window/localStorage stub ------------------------ */

function makeLocalStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
  };
}

type FetchCall = { url: string; method: string; body: unknown };

/** fetch stub: records calls; `failing` makes every request fail. */
function makeFetch(state: { failing: boolean; calls: FetchCall[] }) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    state.calls.push(call);
    if (state.failing) throw new TypeError("network down");
    return new Response(JSON.stringify({ ok: true, verdicts: {} }), { status: 200 });
  });
}

const net = { failing: false, calls: [] as FetchCall[] };

beforeEach(() => {
  net.failing = false;
  net.calls = [];
  vi.stubGlobal("window", { localStorage: makeLocalStorage() } as unknown as Window);
  vi.stubGlobal("fetch", makeFetch(net));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const flushMicro = () => new Promise((r) => setTimeout(r, 0));
const mkStore = () => new QAStore({ target: "t1", stateUrl: "/api/qa/state" });

describe("real-time server writes", () => {
  it("persist() POSTs the verdict immediately", async () => {
    const s = mkStore();
    s.persist("hero", { verdict: "approve", variant: 2 });
    await flushMicro();
    const posts = net.calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ target: "t1", itemId: "hero", verdict: "approve", variant: 2 });
    expect(s.pendingOps()).toHaveLength(0); // delivered -> queue drained
  });

  it("remove() (undo) POSTs verdict:null immediately", async () => {
    const s = mkStore();
    s.remove("hero");
    await flushMicro();
    const posts = net.calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ target: "t1", itemId: "hero", verdict: null });
  });

  it("debounced note change POSTs after the debounce window", async () => {
    vi.useFakeTimers();
    const s = new QAStore({ target: "t1", noteDebounceMs: 600 });
    s.persistNoteDebounced("hero", "first");
    s.persistNoteDebounced("hero", "first draft "); // retype resets the timer
    await vi.advanceTimersByTimeAsync(599);
    expect(net.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    await vi.runOnlyPendingTimersAsync();
    const posts = net.calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1); // coalesced to ONE write
    expect(posts[0].body).toEqual({ target: "t1", itemId: "hero", note: "first draft" });
  });

  it("cancelPendingNote() suppresses the queued note write", async () => {
    vi.useFakeTimers();
    const s = new QAStore({ target: "t1" });
    s.persistNoteDebounced("hero", "typed");
    s.cancelPendingNote("hero");
    await vi.advanceTimersByTimeAsync(2000);
    expect(net.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("write-behind queue (offline resilience)", () => {
  it("failed write stays queued (persisted) and localStorage keeps the verdict", async () => {
    net.failing = true;
    const s = mkStore();
    s.persist("hero", { verdict: "approve" });
    await flushMicro();
    expect(s.pendingOps()).toEqual([{ itemId: "hero", patch: { verdict: "approve" } }]);
    expect(s.load().hero).toEqual({ verdict: "approve" }); // never lost locally
  });

  it("queued ops replay IN ORDER on the next action", async () => {
    net.failing = true;
    const s = mkStore();
    s.persist("a", { verdict: "approve" });
    await flushMicro();
    s.remove("a"); // still offline
    await flushMicro();
    expect(s.pendingOps()).toHaveLength(2);

    net.failing = false;
    net.calls = [];
    s.persist("b", { verdict: "reject" }); // next action triggers the replay
    await flushMicro();
    const posts = net.calls.filter((c) => c.method === "POST").map((c) => c.body) as Array<
      Record<string, unknown>
    >;
    expect(posts).toEqual([
      { target: "t1", itemId: "a", verdict: "approve" },
      { target: "t1", itemId: "a", verdict: null },
      { target: "t1", itemId: "b", verdict: "reject" },
    ]);
    expect(s.pendingOps()).toHaveLength(0);
  });

  it("pending queue survives a reload (new store instance sees it)", async () => {
    net.failing = true;
    const s1 = mkStore();
    s1.persist("hero", { verdict: "approve" });
    await flushMicro();

    const s2 = mkStore(); // same window/localStorage = same browser after reload
    expect(s2.pendingOps()).toEqual([{ itemId: "hero", patch: { verdict: "approve" } }]);
  });

  it("serverLoad() flushes first and replays still-pending ops over the server map", async () => {
    net.failing = true;
    const s = mkStore();
    s.persist("hero", { verdict: "approve" });
    await flushMicro();

    // Server has stale emptiness for hero + an unrelated verdict; still offline
    // for POST, but pretend GET works: simulate by targeted fetch behavior.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "POST") throw new TypeError("still down");
        return new Response(
          JSON.stringify({ ok: true, verdicts: { other: { verdict: "reject" } } }),
          { status: 200 },
        );
      }),
    );

    const map = await s.serverLoad();
    // The undelivered approve must WIN over the server's ignorance of it.
    expect(map).toEqual({ other: { verdict: "reject" }, hero: { verdict: "approve" } });
    expect(s.pendingOps()).toHaveLength(1); // still queued for a later retry
  });
});
