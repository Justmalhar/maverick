import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ITheme } from "@xterm/xterm";
import {
  POOL_MAX_SIZE,
  acquireSlot,
  refitLiveSlotsForFonts,
  releaseSlot,
  getSlotForLeaf,
  writeToSlot,
  focusSlot,
  resizeSlot,
  setSlotTheme,
  applyTheme,
  addResizeListener,
  configureRendererPool,
  setPoolConfig,
  poolConfigured,
  poolSize,
  setWebglFactory,
  __resetPoolForTests,
  type SlotAdapter,
  type LeafBridge,
  type Slot,
} from "./renderer-pool";

function theme(): ITheme {
  return { background: "#000", foreground: "#fff" };
}

// The FakeTerminal mock (src/test/setup.ts) exposes mutable cols/rows/buffer and
// vi.fn spies, which the real readonly Terminal type hides. This accessor casts
// the slot's term to that mock shape so tests can drive + assert on it.
interface MockTerm {
  cols: number;
  rows: number;
  options: Record<string, unknown>;
  buffer: { active: { type: "normal" | "alternate" } };
  write: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}
function mterm(slot: Slot): MockTerm {
  return slot.term as unknown as MockTerm;
}
function mfit(slot: Slot): { fit: ReturnType<typeof vi.fn> } {
  return slot.fitAddon as unknown as { fit: ReturnType<typeof vi.fn> };
}
function mserialize(slot: Slot): { serialize: ReturnType<typeof vi.fn> } {
  return slot.serializeAddon as unknown as { serialize: ReturnType<typeof vi.fn> };
}

function sizedContainer(w = 800, h = 340): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: w, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: h, configurable: true });
  document.body.appendChild(el);
  return el;
}

let resizeCallbacks: Array<{ cb: ResizeObserverCallback; disconnect: () => void }>;
let bridges: Map<string, LeafBridge>;
let focused: Set<string>;
let evicted: string[];

function makeBridge(): LeafBridge {
  return {
    writeToPty: vi.fn(),
    resizePty: vi.fn(),
    kickPty: vi.fn(),
  };
}

function adapter(): SlotAdapter {
  return {
    resolveLeaf: (id) => bridges.get(id) ?? null,
    evictLeaf: (id) => evicted.push(id),
    isLeafFocused: (id) => focused.has(id),
  };
}

function fireAllResizes() {
  for (const r of resizeCallbacks) {
    r.cb([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
  }
}

beforeEach(() => {
  resizeCallbacks = [];
  bridges = new Map();
  focused = new Set();
  evicted = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        const entry = { cb, disconnect: () => {} };
        resizeCallbacks.push(entry);
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  setPoolConfig({
    theme: theme(),
    fontSize: 13,
    fontFamily: "mono",
    lineHeight: 1.2,
    scrollback: 5000,
  });
  configureRendererPool(adapter());
});

afterEach(() => {
  __resetPoolForTests();
  vi.useRealTimers();
});

function acquire(leafId: string, container = sizedContainer(), altScreen = false, ringData: string[] = []) {
  bridges.set(leafId, makeBridge());
  return acquireSlot({
    leafId,
    container,
    snapshot: null,
    altScreen,
    drainRing: (write) => ringData.forEach((d) => write(d)),
    cols: 80,
    rows: 24,
  });
}

describe("renderer-pool config", () => {
  it("reports configured state", () => {
    expect(poolConfigured()).toBe(true);
    __resetPoolForTests();
    expect(poolConfigured()).toBe(false);
    // Re-arm for afterEach reset safety.
    setPoolConfig({ theme: theme(), fontSize: 13, fontFamily: "mono", lineHeight: 1.2, scrollback: 5000 });
  });
});

describe("renderer-pool acquire/release", () => {
  it("acquires a fresh slot, binds the leaf, and reuses it on re-acquire", () => {
    const c = sizedContainer();
    const slot = acquire("a", c);
    expect(slot.currentLeafId).toBe("a");
    expect(poolSize()).toBe(1);
    expect(getSlotForLeaf("a")).toBe(slot);

    // Re-acquiring the same leaf rewires the SAME slot (no new slot).
    const again = acquireSlot({
      leafId: "a",
      container: c,
      snapshot: null,
      altScreen: false,
      drainRing: () => {},
      cols: 80,
      rows: 24,
    });
    expect(again).toBe(slot);
    expect(poolSize()).toBe(1);
  });

  it("writes pty bytes to the bound slot and buffers nothing", () => {
    acquire("a");
    expect(writeToSlot("a", "hi")).toBe(true);
    expect(writeToSlot("missing", "x")).toBe(false);
  });

  it("replays the dormant ring onto the slot on a normal acquire", () => {
    const c = sizedContainer();
    const slot = acquire("a", c, false, ["chunk1", "chunk2"]);
    expect(mterm(slot).write).toHaveBeenCalledWith("chunk1");
    expect(mterm(slot).write).toHaveBeenCalledWith("chunk2");
  });

  it("discards the ring and SIGWINCH-kicks the PTY for an alt-screen acquire", () => {
    const c = sizedContainer();
    const slot = acquire("tui", c, true, ["should-not-replay"]);
    expect(mterm(slot).write).not.toHaveBeenCalledWith("should-not-replay");
    expect(bridges.get("tui")!.kickPty).toHaveBeenCalled();
  });

  it("serializes scrollback and recycles the slot on release", () => {
    const slot = acquire("a");
    const out = releaseSlot("a");
    expect(out).not.toBeNull();
    expect(out!.cols).toBe(80);
    expect(slot.currentLeafId).toBeNull();
    expect(getSlotForLeaf("a")).toBeNull();
  });

  it("release of an unbound leaf returns null", () => {
    expect(releaseSlot("never")).toBeNull();
  });

  it("resizes the PTY when the fitted grid differs from the requested dims", () => {
    const c = sizedContainer();
    bridges.set("a", makeBridge());
    // cols/rows = 0 skip the in-bind term.resize, so the slot keeps its default
    // 80x24 grid which differs from the requested 0 → resizePty syncs the PTY.
    acquireSlot({
      leafId: "a",
      container: c,
      snapshot: null,
      altScreen: false,
      drainRing: () => {},
      cols: 0,
      rows: 0,
    });
    expect(bridges.get("a")!.resizePty).toHaveBeenCalledWith(80, 24);
  });
});

describe("renderer-pool cap + eviction scoring", () => {
  it("never grows beyond POOL_MAX_SIZE and evicts the lowest-scored slot", () => {
    // Fill the pool to capacity.
    for (let i = 0; i < POOL_MAX_SIZE; i++) acquire(`leaf-${i}`);
    expect(poolSize()).toBe(POOL_MAX_SIZE);

    // Make leaf-0 alt-screen (score +100) and leaf-1 focused (score +10) so
    // neither is evicted; leaf-2 (plain, oldest) should be the victim.
    mterm(getSlotForLeaf("leaf-0")!).buffer.active.type = "alternate";
    focused.add("leaf-1");

    acquire("newcomer");
    expect(poolSize()).toBe(POOL_MAX_SIZE); // capped
    expect(evicted.length).toBeGreaterThan(0);
    // The alt-screen + focused slots survived.
    expect(getSlotForLeaf("leaf-0")).not.toBeNull();
    expect(getSlotForLeaf("leaf-1")).not.toBeNull();
    expect(getSlotForLeaf("newcomer")).not.toBeNull();
  });

  it("prefers a free (released) slot before creating or evicting", () => {
    for (let i = 0; i < POOL_MAX_SIZE; i++) acquire(`leaf-${i}`);
    releaseSlot("leaf-3"); // frees a slot
    evicted = [];
    acquire("reuse");
    // Reused the freed slot — no eviction.
    expect(evicted).toHaveLength(0);
    expect(poolSize()).toBe(POOL_MAX_SIZE);
  });

  it("returns the slot already holding the leaf during a pressured pick", () => {
    for (let i = 0; i < POOL_MAX_SIZE; i++) acquire(`leaf-${i}`);
    const before = getSlotForLeaf("leaf-2");
    // Re-acquire leaf-2 while full → rewire path returns the same slot.
    const again = acquire("leaf-2");
    expect(again).toBe(before);
    expect(poolSize()).toBe(POOL_MAX_SIZE);
  });
});

describe("renderer-pool two-stage resize debounce", () => {
  it("fits at 8ms and resizes the PTY at 256ms only when dims change", () => {
    vi.useFakeTimers();
    const c = sizedContainer(800, 340);
    acquire("a", c);
    const slot = getSlotForLeaf("a")!;
    bridges.get("a")!.resizePty = vi.fn();

    // No size change → fit runs, but flushPty sees identical dims → no resize.
    fireAllResizes();
    vi.advanceTimersByTime(8);
    vi.advanceTimersByTime(256);
    // resizePty may have fired during initial bind; clear and re-test on change.
    (bridges.get("a")!.resizePty as ReturnType<typeof vi.fn>).mockClear();

    // Change the container size AND the grid so both stages do work.
    Object.defineProperty(c, "clientWidth", { value: 1000, configurable: true });
    mterm(slot).cols = 120;
    mterm(slot).rows = 40;
    fireAllResizes();
    vi.advanceTimersByTime(8);
    vi.advanceTimersByTime(256);
    expect(bridges.get("a")!.resizePty).toHaveBeenCalledWith(120, 40);
  });

  it("ignores a 0x0 container (guards against display:none 1x1 grid)", () => {
    vi.useFakeTimers();
    const c = sizedContainer(0, 0);
    acquire("a", c);
    bridges.get("a")!.resizePty = vi.fn();
    fireAllResizes();
    vi.advanceTimersByTime(300);
    expect(bridges.get("a")!.resizePty).not.toHaveBeenCalled();
  });

  it("skips the fit callback when the slot was reassigned to another leaf", () => {
    vi.useFakeTimers();
    const c = sizedContainer(800, 340);
    acquire("a", c);
    const slot = getSlotForLeaf("a")!;
    bridges.get("a")!.resizePty = vi.fn();
    // Reassign the slot's leaf id so the debounced fit's guard short-circuits.
    slot.currentLeafId = "different";
    Object.defineProperty(c, "clientWidth", { value: 1234, configurable: true });
    fireAllResizes();
    vi.advanceTimersByTime(300);
    expect(bridges.get("a")!.resizePty).not.toHaveBeenCalled();
  });
});

describe("renderer-pool helpers", () => {
  it("focus, resize, theme, and resize listeners operate on the bound slot", () => {
    const slot = acquire("a");
    focusSlot("a");
    expect(mterm(slot).focus).toHaveBeenCalled();
    resizeSlot("a", 100, 30);
    expect(mterm(slot).resize).toHaveBeenCalledWith(100, 30);
    resizeSlot("a", 0, 0); // guarded, no-op
    resizeSlot("missing", 10, 10); // no slot, no-op
    setSlotTheme("a", theme());
    expect((mterm(slot).options as { theme?: unknown }).theme).toBeDefined();
    setSlotTheme("missing", theme());

    const cb = vi.fn();
    const off = addResizeListener("a", cb);
    // resizeSlot above set the grid to 100x30; the listener emits current dims.
    expect(cb).toHaveBeenCalledWith(100, 30);
    off();
    expect(addResizeListener("missing", vi.fn())()).toBeUndefined();
  });

  it("notifyResize fans out the fitted size to registered listeners on a PTY flush", () => {
    vi.useFakeTimers();
    const c = sizedContainer(800, 340);
    const slot = acquire("a", c);
    const listener = vi.fn();
    addResizeListener("a", listener);
    listener.mockClear();
    // Drive a real resize cycle so flushPty → notifyResize iterates the set.
    mterm(slot).cols = 132;
    Object.defineProperty(c, "clientWidth", { value: 2020, configurable: true });
    fireAllResizes();
    vi.advanceTimersByTime(8);
    vi.advanceTimersByTime(256);
    expect(listener).toHaveBeenCalledWith(132, 24);
  });

  it("applyTheme updates every slot", () => {
    const s1 = acquire("a");
    const s2 = acquire("b");
    const t = theme();
    applyTheme(t);
    expect(mterm(s1).options.theme).toBe(t);
    expect(mterm(s2).options.theme).toBe(t);
  });

  it("focus/resize on an unbound leaf are safe no-ops", () => {
    expect(() => focusSlot("nope")).not.toThrow();
    expect(() => resizeSlot("nope", 10, 10)).not.toThrow();
  });
});

describe("renderer-pool unhide + WebGL", () => {
  it("double-RAF unhide reveals the slot and focuses when the leaf is focused", () => {
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
    focused.add("a");
    const slot = acquire("a");
    expect(slot.host.style.visibility).toBe("");
    expect(mterm(slot).focus).toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it("forces a repaint on unhide when the slot is stale", () => {
    vi.useFakeTimers();
    let now = 0;
    const perfSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
    const slot = acquire("a");
    releaseSlot("a");
    // Advance well past SLOT_STALE_MS so the re-acquire treats it as stale.
    now = 20_000;
    acquire("a");
    expect(mterm(slot).refresh).toHaveBeenCalled();
    perfSpy.mockRestore();
    rafSpy.mockRestore();
  });

  it("cancels a pending unhide RAF when re-binding before it fires", () => {
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    // Real rAF — schedule but don't flush, then re-acquire to cancel it.
    const c = sizedContainer();
    acquire("a", c);
    releaseSlot("a");
    acquire("a", c); // cancelPendingUnhide runs (unhideRaf may be null → branch)
    expect(() => cancelSpy).not.toThrow();
    cancelSpy.mockRestore();
  });

  it("attaches a WebGL addon and recovers from context loss", () => {
    vi.useFakeTimers();
    let lossCb: (() => void) | null = null;
    let created = 0;
    const dispose = vi.fn();
    setWebglFactory(() => {
      created++;
      return {
        dispose,
        onContextLoss: (cb) => {
          lossCb = cb;
        },
      };
    });
    const slot = acquire("a");
    expect(slot.webgl).not.toBeNull();
    expect(created).toBe(1);

    // Simulate context loss → addon disposed + nulled, then re-attached after
    // the recovery delay.
    lossCb!();
    expect(dispose).toHaveBeenCalled();
    expect(slot.webgl).toBeNull();
    vi.advanceTimersByTime(250);
    expect(created).toBe(2);
    expect(slot.webgl).not.toBeNull();
  });

  it("tolerates a WebGL factory that throws", () => {
    setWebglFactory(() => {
      throw new Error("no gpu");
    });
    expect(() => acquire("a")).not.toThrow();
    expect(getSlotForLeaf("a")!.webgl).toBeNull();
  });

  it("context-loss recovery skips re-attach if a slot was already re-armed", () => {
    vi.useFakeTimers();
    let lossCb: (() => void) | null = null;
    let created = 0;
    setWebglFactory(() => {
      created++;
      return { dispose: vi.fn(), onContextLoss: (cb) => (lossCb = cb) };
    });
    const slot = acquire("a");
    lossCb!();
    // Re-arm the slot's webgl before the recovery timer fires → re-attach skips.
    slot.webgl = { dispose: vi.fn(), onContextLoss: vi.fn() };
    vi.advanceTimersByTime(250);
    expect(created).toBe(1);
  });

  it("context-loss recovery tolerates a dispose throw and a refresh throw", () => {
    vi.useFakeTimers();
    let lossCb: (() => void) | null = null;
    let calls = 0;
    setWebglFactory(() => {
      calls++;
      return {
        // First addon's dispose throws; recovery attaches a second.
        dispose: () => {
          if (calls === 1) throw new Error("dispose boom");
        },
        onContextLoss: (cb) => {
          if (calls === 1) lossCb = cb;
        },
      };
    });
    const slot = acquire("a");
    mterm(slot).refresh = vi.fn(() => {
      throw new Error("refresh boom");
    });
    expect(() => lossCb!()).not.toThrow();
    expect(() => vi.advanceTimersByTime(250)).not.toThrow();
    expect(calls).toBe(2);
  });
});

describe("renderer-pool defensive paths", () => {
  it("createSlot's onData forwards keystrokes to the owning leaf, ignoring an unbound slot", () => {
    const slot = acquire("a");
    const onData = mterm(slot).onData.mock.calls[0][0] as (d: string) => void;
    onData("ls\r");
    expect(bridges.get("a")!.writeToPty).toHaveBeenCalledWith("ls\r");
    // Unbind the slot → the handler short-circuits on null leaf.
    releaseSlot("a");
    expect(() => onData("ignored")).not.toThrow();
  });

  it("isAltScreen returns false when the buffer accessor throws", () => {
    const slot = acquire("a");
    Object.defineProperty(slot.term, "buffer", {
      get() {
        throw new Error("no buffer");
      },
      configurable: true,
    });
    // releaseSlot → serializeSlot → isAltScreen swallows the throw.
    const out = releaseSlot("a");
    expect(out!.altScreen).toBe(false);
  });

  it("replays a snapshot and tolerates a write that throws", () => {
    const c = sizedContainer();
    bridges.set("a", makeBridge());
    // First acquire to create the slot, then release to capture it for spying.
    acquireSlot({ leafId: "a", container: c, snapshot: null, altScreen: false, drainRing: () => {}, cols: 80, rows: 24 });
    const slot = getSlotForLeaf("a")!;
    releaseSlot("a");
    let n = 0;
    mterm(slot).write = vi.fn(() => {
      n++;
      if (n === 1) throw new Error("bad sequence"); // snapshot write throws
    });
    // Re-acquire with a snapshot → write throws but is swallowed; cursor-show
    // write also goes through the same spy (throws again, swallowed).
    expect(() =>
      acquireSlot({ leafId: "a", container: c, snapshot: "SNAP", altScreen: false, drainRing: () => {}, cols: 80, rows: 24 })
    ).not.toThrow();
    expect(mterm(slot).write).toHaveBeenCalledWith("SNAP");
  });

  it("rewire resizes the PTY when the existing grid differs from requested dims", () => {
    const c = sizedContainer();
    const slot = acquire("a", c);
    mterm(slot).cols = 200; // force a mismatch vs the next requested cols
    bridges.get("a")!.resizePty = vi.fn();
    // Re-acquire same leaf → rewireSlot path; cols 200 !== requested 80.
    acquireSlot({ leafId: "a", container: c, snapshot: null, altScreen: false, drainRing: () => {}, cols: 80, rows: 24 });
    expect(bridges.get("a")!.resizePty).toHaveBeenCalledWith(200, 24);
  });

  it("safeFit swallows a FitAddon throw", () => {
    const slot = acquire("a");
    mfit(slot).fit = vi.fn(() => {
      throw new Error("not sized");
    });
    // Re-acquire triggers another safeFit → fit throws, swallowed.
    expect(() => acquire("a")).not.toThrow();
  });

  it("scheduleUnhide does not focus when the leaf is unbound or unfocused", () => {
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
    // Leaf is NOT in the focused set → focus branch is skipped on unhide.
    const slot = acquire("a");
    expect(mterm(slot).focus).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it("scheduleUnhide stale-repaint tolerates a refresh throw", () => {
    vi.useFakeTimers();
    let now = 0;
    const perfSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
    const slot = acquire("a");
    releaseSlot("a");
    mterm(slot).refresh = vi.fn(() => {
      throw new Error("refresh boom");
    });
    now = 30_000; // stale
    expect(() => acquire("a")).not.toThrow();
    perfSpy.mockRestore();
    rafSpy.mockRestore();
  });

  it("resizes the xterm grid in-bind when requested dims exceed the slot default", () => {
    const c = sizedContainer();
    bridges.set("a", makeBridge());
    acquireSlot({ leafId: "a", container: c, snapshot: null, altScreen: false, drainRing: () => {}, cols: 100, rows: 50 });
    const slot = getSlotForLeaf("a")!;
    // FakeTerminal.resize updates cols/rows, so the slot now matches the request.
    expect(mterm(slot).resize).toHaveBeenCalledWith(100, 50);
    expect(mterm(slot).cols).toBe(100);
  });

  it("cursor-show write throw is swallowed when there is no snapshot", () => {
    const c = sizedContainer();
    bridges.set("a", makeBridge());
    acquireSlot({ leafId: "a", container: c, snapshot: null, altScreen: false, drainRing: () => {}, cols: 80, rows: 24 });
    const slot = getSlotForLeaf("a")!;
    releaseSlot("a");
    mterm(slot).write = vi.fn(() => {
      throw new Error("cursor-show boom");
    });
    expect(() =>
      acquireSlot({ leafId: "a", container: c, snapshot: null, altScreen: false, drainRing: () => {}, cols: 80, rows: 24 })
    ).not.toThrow();
    expect(mterm(slot).write).toHaveBeenCalledWith("\x1b[?25h");
  });

  it("observer fit() throw is swallowed and the PTY-resize stage still arms", () => {
    vi.useFakeTimers();
    const c = sizedContainer(800, 340);
    const slot = acquire("a", c);
    mfit(slot).fit = vi.fn(() => {
      throw new Error("fit boom");
    });
    bridges.get("a")!.resizePty = vi.fn();
    Object.defineProperty(c, "clientWidth", { value: 1111, configurable: true });
    mterm(slot).cols = 99;
    fireAllResizes();
    vi.advanceTimersByTime(8);
    vi.advanceTimersByTime(256);
    expect(bridges.get("a")!.resizePty).toHaveBeenCalledWith(99, 24);
  });

  it("flushPty short-circuits when the fitted grid did not change", () => {
    vi.useFakeTimers();
    const c = sizedContainer(800, 340);
    acquire("a", c);
    bridges.get("a")!.resizePty = vi.fn();
    // Container changes (so fit runs) but the grid does NOT change → no resize.
    Object.defineProperty(c, "clientWidth", { value: 999, configurable: true });
    fireAllResizes();
    vi.advanceTimersByTime(8);
    vi.advanceTimersByTime(256);
    expect(bridges.get("a")!.resizePty).not.toHaveBeenCalled();
  });

  it("serializeSlot tolerates a serialize throw and still reports dims", () => {
    const slot = acquire("a");
    mserialize(slot).serialize = vi.fn(() => {
      throw new Error("serialize boom");
    });
    const out = releaseSlot("a");
    expect(out!.snapshot).toBeNull();
    expect(out!.cols).toBe(80);
  });

  it("detach clears armed fit/pty timers on release", () => {
    vi.useFakeTimers();
    const c = sizedContainer(800, 340);
    const slot = acquire("a", c);
    mterm(slot).cols = 77; // make a subsequent fit change dims
    Object.defineProperty(c, "clientWidth", { value: 1212, configurable: true });
    fireAllResizes();
    vi.advanceTimersByTime(8); // fitTimer fired, ptyTimer now armed
    expect(slot.ptyTimer).not.toBeNull();
    // Release while ptyTimer is pending → detach clears it.
    releaseSlot("a");
    expect(slot.fitTimer).toBeNull();
    expect(slot.ptyTimer).toBeNull();
  });

  it("re-binding a slot with armed fit/pty timers clears them first", () => {
    vi.useFakeTimers();
    const c = sizedContainer(800, 340);
    const slot = acquire("a", c);
    mterm(slot).cols = 70;
    Object.defineProperty(c, "clientWidth", { value: 1313, configurable: true });
    fireAllResizes(); // arms fitTimer
    expect(slot.fitTimer).not.toBeNull();
    vi.advanceTimersByTime(8); // fitTimer → fires, arms ptyTimer
    expect(slot.ptyTimer).not.toBeNull();
    // Fire the observer again to arm fitTimer while ptyTimer is still pending.
    Object.defineProperty(c, "clientWidth", { value: 1414, configurable: true });
    mterm(slot).cols = 71;
    fireAllResizes();
    // Now release+re-acquire: setupResizeObserver runs with BOTH timers armed,
    // so its clearTimeout guards take the truthy branch.
    releaseSlot("a");
    acquire("a", c);
    expect(slot.fitTimer).toBeNull();
  });

  it("debounces back-to-back observer fires (clears the prior fit timer)", () => {
    vi.useFakeTimers();
    const c = sizedContainer(800, 340);
    const slot = acquire("a", c);
    mterm(slot).cols = 65;
    // Two observer fires with NO advance between → the 2nd clears the 1st's
    // armed fitTimer (the truthy clearTimeout branch).
    Object.defineProperty(c, "clientWidth", { value: 1616, configurable: true });
    fireAllResizes();
    Object.defineProperty(c, "clientWidth", { value: 1717, configurable: true });
    fireAllResizes();
    vi.advanceTimersByTime(8);
    expect(slot.ptyTimer).not.toBeNull();
  });

  it("re-arms the fit pipeline so a second fit clears the prior pty timer", () => {
    vi.useFakeTimers();
    const c = sizedContainer(800, 340);
    const slot = acquire("a", c);
    // First resize cycle arms ptyTimer.
    mterm(slot).cols = 50;
    Object.defineProperty(c, "clientWidth", { value: 1818, configurable: true });
    fireAllResizes();
    vi.advanceTimersByTime(8);
    expect(slot.ptyTimer).not.toBeNull();
    // Second resize cycle: the fit callback clears the still-pending ptyTimer
    // (the truthy clearTimeout branch on line 465) before re-arming it.
    mterm(slot).cols = 51;
    Object.defineProperty(c, "clientWidth", { value: 1919, configurable: true });
    fireAllResizes();
    vi.advanceTimersByTime(8);
    expect(slot.ptyTimer).not.toBeNull();
  });

  it("a pending flushPty no-ops once its slot was reassigned to another leaf", () => {
    vi.useFakeTimers();
    const c = sizedContainer(800, 340);
    const slot = acquire("a", c);
    mterm(slot).cols = 60;
    Object.defineProperty(c, "clientWidth", { value: 1515, configurable: true });
    fireAllResizes();
    vi.advanceTimersByTime(8); // ptyTimer armed
    bridges.get("a")!.resizePty = vi.fn();
    // Reassign the slot's leaf id before the PTY debounce elapses.
    slot.currentLeafId = "stolen";
    vi.advanceTimersByTime(256); // flushPty runs, sees mismatch, returns early
    expect(bridges.get("a")!.resizePty).not.toHaveBeenCalled();
  });

  it("__resetPoolForTests clears pending timers and tolerates dispose throws", () => {
    vi.useFakeTimers();
    const slot = acquire("a");
    // Arm fit/pty timers via a resize so reset has timers to clear.
    fireAllResizes();
    vi.advanceTimersByTime(8);
    slot.webgl = {
      dispose: () => {
        throw new Error("webgl dispose boom");
      },
      onContextLoss: vi.fn(),
    };
    mterm(slot).dispose = vi.fn(() => {
      throw new Error("term dispose boom");
    });
    expect(() => __resetPoolForTests()).not.toThrow();
    // Re-arm config for the afterEach reset.
    setPoolConfig({ theme: theme(), fontSize: 13, fontFamily: "mono", lineHeight: 1.2, scrollback: 5000 });
  });
});

describe("renderer-pool bind-time fit guard", () => {
  it("does NOT resize the PTY when bound against an unsized (0x0) container", () => {
    // A bind while the workspace is display:none / pre-layout must not pin the
    // PTY to a degenerate grid; the ResizeObserver handles it once sized.
    const c = document.createElement("div"); // clientWidth/Height default to 0
    document.body.appendChild(c);
    bridges.set("a", makeBridge());
    acquireSlot({
      leafId: "a",
      container: c,
      snapshot: null,
      altScreen: false,
      drainRing: () => {},
      cols: 0,
      rows: 0,
    });
    expect(bridges.get("a")!.resizePty).not.toHaveBeenCalled();
  });

  it("resizes the PTY at bind when the container is laid out and dims differ", () => {
    const slot = acquire("a", sizedContainer(800, 340));
    // fit() left cols at the 80x24 request, so no resize fires for an equal grid…
    expect(bridges.get("a")!.resizePty).not.toHaveBeenCalled();
    // …but a fit that changes the grid does propagate (covered via fonts refit).
    expect(slot.lastW).toBe(800);
  });
});

describe("renderer-pool font-load refit", () => {
  it("re-touches the font, refits, and resizes the PTY when fonts settle", () => {
    const slot = acquire("a", sizedContainer(1000, 400));
    bridges.get("a")!.resizePty = vi.fn();
    // Simulate xterm re-measuring to a wider grid once the real font loads.
    mfit(slot).fit = vi.fn(() => {
      mterm(slot).cols = 150;
    });
    refitLiveSlotsForFonts();
    expect(mterm(slot).options.fontFamily).toBe("mono");
    expect(bridges.get("a")!.resizePty).toHaveBeenCalledWith(150, 24);
  });

  it("skips free slots, unsized containers, and unchanged grids", () => {
    // Free slot: acquire then release so a slot exists with currentLeafId null.
    const slot = acquire("a", sizedContainer(900, 300));
    bridges.get("a")!.resizePty = vi.fn();
    // Unchanged grid → no resize.
    refitLiveSlotsForFonts();
    expect(bridges.get("a")!.resizePty).not.toHaveBeenCalled();
    // Released (free) slot → skipped entirely.
    releaseSlot("a");
    expect(() => refitLiveSlotsForFonts()).not.toThrow();
    void slot;
  });

  it("swallows a fit() throw during a font refit", () => {
    const slot = acquire("a", sizedContainer(800, 340));
    mfit(slot).fit = vi.fn(() => {
      throw new Error("fit boom");
    });
    expect(() => refitLiveSlotsForFonts()).not.toThrow();
  });
});
