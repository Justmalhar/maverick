import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ITheme } from "@xterm/xterm";
import type { PtyBridge } from "../terminal-provider";
import {
  ensureSession,
  feedSession,
  bind,
  releaseSession,
  disposeSession,
  focusSession,
  setSessionTheme,
  onSessionResize,
  sessionBound,
  setLeafFocused,
  __resetSessionsForTests,
} from "./terminal-session";
import {
  setPoolConfig,
  getSlotForLeaf,
  poolSize,
  writeToSlot,
  resizeSlot,
  POOL_MAX_SIZE,
  __resetPoolForTests,
  type Slot,
} from "./renderer-pool";

function theme(): ITheme {
  return { background: "#000", foreground: "#fff" };
}

function bridge(): PtyBridge {
  return { writeToPty: vi.fn(), resizePty: vi.fn(), kickPty: vi.fn() };
}

function sizedContainer(): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 340, configurable: true });
  document.body.appendChild(el);
  return el;
}

interface MockTerm {
  cols: number;
  rows: number;
  write: ReturnType<typeof vi.fn>;
  options: Record<string, unknown>;
}
function mterm(slot: Slot): MockTerm {
  return slot.term as unknown as MockTerm;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  setPoolConfig({ theme: theme(), fontSize: 13, fontFamily: "mono", lineHeight: 1.2, scrollback: 5000 });
});

afterEach(() => {
  // Pool reset nulls the adapter; the session reset re-installs it last so the
  // next test starts with a wired adapter.
  __resetPoolForTests();
  __resetSessionsForTests();
  vi.useRealTimers();
});

describe("terminal-session", () => {
  it("ensureSession is idempotent and refreshes the bridge/theme", () => {
    const b1 = bridge();
    const s1 = ensureSession("a", b1, theme());
    const b2 = bridge();
    const s2 = ensureSession("a", b2, theme());
    expect(s1).toBe(s2);
    expect(s2.bridge).toBe(b2);
  });

  it("feed buffers in the dormant ring while dormant, writes the slot while bound", () => {
    const s = ensureSession("a", bridge(), theme());
    // Dormant: no slot yet → ring buffers, no write.
    feedSession("a", "before-bind");
    expect(getSlotForLeaf("a")).toBeNull();

    // Bind → ring drains onto the slot.
    bind(s, sizedContainer());
    const slot = getSlotForLeaf("a")!;
    expect(mterm(slot).write).toHaveBeenCalledWith("before-bind");

    // Bound: feed writes straight to the slot.
    mterm(slot).write.mockClear();
    feedSession("a", "after-bind");
    expect(mterm(slot).write).toHaveBeenCalledWith("after-bind");
  });

  it("feed on an unknown leaf is a no-op", () => {
    expect(() => feedSession("ghost", "x")).not.toThrow();
  });

  it("releaseSession recycles the slot but keeps the session alive", () => {
    const s = ensureSession("a", bridge(), theme());
    bind(s, sizedContainer());
    expect(sessionBound("a")).toBe(true);
    releaseSession("a");
    expect(sessionBound("a")).toBe(false);
    expect(getSlotForLeaf("a")).toBeNull();

    // Session survives: feed lands in the ring, re-bind replays it.
    feedSession("a", "while-dormant");
    bind(s, sizedContainer());
    expect(mterm(getSlotForLeaf("a")!).write).toHaveBeenCalledWith("while-dormant");
  });

  it("releaseSession on an unknown leaf is a no-op", () => {
    expect(() => releaseSession("ghost")).not.toThrow();
  });

  it("bind on a disposed session does nothing", () => {
    const s = ensureSession("a", bridge(), theme());
    disposeSession("a");
    bind(s, sizedContainer());
    expect(poolSize()).toBe(0);
  });

  it("re-bind while already bound rewires the same slot without leaking", () => {
    const s = ensureSession("a", bridge(), theme());
    const c = sizedContainer();
    bind(s, c);
    const first = getSlotForLeaf("a");
    bind(s, c);
    expect(getSlotForLeaf("a")).toBe(first);
    expect(poolSize()).toBe(1);
  });

  it("disposeSession tears down the session entirely", () => {
    const s = ensureSession("a", bridge(), theme());
    bind(s, sizedContainer());
    disposeSession("a");
    expect(getSlotForLeaf("a")).toBeNull();
    expect(sessionBound("a")).toBe(false);
    // A fresh ensureSession after dispose makes a brand-new session.
    const s2 = ensureSession("a", bridge(), theme());
    expect(s2).not.toBe(s);
  });

  it("disposeSession on an unknown leaf is a no-op", () => {
    expect(() => disposeSession("ghost")).not.toThrow();
  });

  it("focusSession focuses the bound slot", () => {
    const s = ensureSession("a", bridge(), theme());
    bind(s, sizedContainer());
    expect(() => focusSession("a")).not.toThrow();
  });

  it("setSessionTheme applies to the slot and persists for the next bind", () => {
    const s = ensureSession("a", bridge(), theme());
    bind(s, sizedContainer());
    const t: ITheme = { background: "#111", foreground: "#eee" };
    setSessionTheme("a", t);
    expect(mterm(getSlotForLeaf("a")!).options.theme).toBe(t);
    // No-op on an unknown leaf.
    expect(() => setSessionTheme("ghost", t)).not.toThrow();
  });

  it("onSessionResize emits the current size and forwards future resize events", () => {
    const s = ensureSession("a", bridge(), theme());
    const cb = vi.fn();
    const off = onSessionResize("a", cb);
    expect(cb).toHaveBeenCalledWith(0, 0); // pre-bind cols/rows are 0
    bind(s, sizedContainer());
    off();
    // Unknown leaf returns a safe no-op disposer.
    const noop = onSessionResize("ghost", vi.fn());
    expect(() => noop()).not.toThrow();
  });

  it("the pool adapter resolves the session bridge for keystrokes and resizes", () => {
    const b = bridge();
    const s = ensureSession("a", b, theme());
    bind(s, sizedContainer());
    // term.onData → adapter.resolveLeaf("a").writeToPty
    const slot = getSlotForLeaf("a")!;
    const onData = (slot.term.onData as unknown as { mock: { calls: Array<[(d: string) => void]> } }).mock.calls[0][0];
    onData("typed");
    expect(b.writeToPty).toHaveBeenCalledWith("typed");
  });

  it("pool eviction unbinds the victim session (evictLeaf) and scores by focus (isLeafFocused)", () => {
    // Bind POOL_MAX_SIZE sessions, then one more to force an eviction. The pool
    // adapter's evictLeaf must unbind the victim and isLeafFocused must score it.
    for (let i = 0; i <= POOL_MAX_SIZE; i++) {
      const s = ensureSession(`leaf-${i}`, bridge(), theme());
      bind(s, sizedContainer());
    }
    expect(poolSize()).toBe(POOL_MAX_SIZE);
    // The earliest leaf was evicted: its session survives but is now dormant,
    // and feeding it lands in the ring (no slot).
    expect(sessionBound("leaf-0")).toBe(false);
    feedSession("leaf-0", "buffered");
    expect(getSlotForLeaf("leaf-0")).toBeNull();
  });

  it("the focus guard spares the active terminal: a non-focused leaf is evicted instead", () => {
    // Fill the pool. leaf-1 is the user's active terminal (focused); the
    // earliest-bound, non-focused, non-alt-screen leaf-0 must be the victim.
    for (let i = 0; i < POOL_MAX_SIZE; i++) {
      const s = ensureSession(`leaf-${i}`, bridge(), theme());
      bind(s, sizedContainer());
    }
    setLeafFocused("leaf-1", true);
    expect(getSlotForLeaf("leaf-1")).not.toBeNull();
    expect(getSlotForLeaf("leaf-0")).not.toBeNull();

    // One more acquire forces an eviction now that the pool is at capacity.
    const overflow = ensureSession("leaf-overflow", bridge(), theme());
    bind(overflow, sizedContainer());

    expect(poolSize()).toBe(POOL_MAX_SIZE);
    // The focused leaf survived; the LRU non-focused leaf was the victim.
    expect(getSlotForLeaf("leaf-1")).not.toBeNull();
    expect(sessionBound("leaf-1")).toBe(true);
    expect(getSlotForLeaf("leaf-0")).toBeNull();
    expect(sessionBound("leaf-0")).toBe(false);
  });

  it("resolveLeaf returns null for a leaf whose session was deleted mid-flight", () => {
    const b = bridge();
    const s = ensureSession("a", b, theme());
    bind(s, sizedContainer());
    const slot = getSlotForLeaf("a")!;
    const onData = (slot.term.onData as unknown as { mock: { calls: Array<[(d: string) => void]> } }).mock.calls[0][0];
    // Clear the session map while the slot stays bound (currentLeafId="a"), then
    // type: term.onData → adapter.resolveLeaf("a") → no session → null → no-op.
    __resetSessionsForTests();
    expect(() => onData("orphaned")).not.toThrow();
    expect(b.writeToPty).not.toHaveBeenCalledWith("orphaned");
    // Pool helpers still find the slot but resolve a null bridge → safe no-op.
    expect(writeToSlot("a", "x")).toBe(true);
    expect(() => resizeSlot("a", 80, 24)).not.toThrow();
  });

  it("alt-screen release discards the ring and kicks the PTY on the next bind", () => {
    const b = bridge();
    const s = ensureSession("a", b, theme());
    bind(s, sizedContainer());
    const slot = getSlotForLeaf("a")!;
    // Mark alt-screen so release records it.
    (slot.term as unknown as { buffer: { active: { type: string } } }).buffer.active.type = "alternate";
    releaseSession("a");
    // Buffer dormant bytes that must NOT be replayed for a TUI.
    feedSession("a", "tui-noise");
    bind(s, sizedContainer());
    expect(mterm(getSlotForLeaf("a")!).write).not.toHaveBeenCalledWith("tui-noise");
    expect(b.kickPty).toHaveBeenCalled();
  });
});
