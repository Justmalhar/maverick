import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { XtermProvider } from "./xterm-provider";
import type { TerminalTheme } from "../ipc";
import type { PtyBridge } from "../terminal-provider";
import { __resetPoolForTests } from "./renderer-pool";
import { __resetSessionsForTests } from "./terminal-session";

function theme(): TerminalTheme {
  return {
    background: "#000", foreground: "#fff", cursor: "#fff",
    black: "#000", red: "#f00", green: "#0f0", yellow: "#ff0",
    blue: "#00f", magenta: "#f0f", cyan: "#0ff", white: "#fff",
    brightBlack: "#111", brightRed: "#f11", brightGreen: "#1f1",
    brightYellow: "#ff1", brightBlue: "#11f", brightMagenta: "#f1f",
    brightCyan: "#1ff", brightWhite: "#fff",
  };
}

interface Stub {
  cols: number; rows: number; options: Record<string, unknown>;
  open: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>; loadAddon: ReturnType<typeof vi.fn>;
}

function sizedContainer(w = 800, h = 340): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: w, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: h, configurable: true });
  return el;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
});

afterEach(() => {
  // Reset the pool first (it nulls the adapter), then sessions which re-install
  // the adapter, so the next test starts wired up.
  __resetPoolForTests();
  __resetSessionsForTests();
  vi.useRealTimers();
});

describe("XtermProvider.mount", () => {
  it("is unimplemented: production uses the pooled acquireLeaf path", () => {
    // mount exists only to satisfy the TerminalProvider interface. Reaching it
    // is a bug, so it throws rather than duplicating the pool's xterm imports.
    const provider = new XtermProvider();
    expect(() => provider.mount(sizedContainer(), {
      theme: theme(), fontSize: 13, fontFamily: "mono", ligatures: false, scrollback: 100,
    })).toThrow(/not implemented/);
  });
});

describe("XtermProvider.acquireLeaf", () => {
  function bridge(): PtyBridge {
    return { writeToPty: vi.fn(), resizePty: vi.fn(), kickPty: vi.fn() };
  }

  it("returns a pooled handle that binds a slot on acquire and serializes on release", () => {
    const provider = new XtermProvider();
    const pooled = provider.acquireLeaf(
      "leaf-1",
      { theme: theme(), fontSize: 13, fontFamily: "mono", lineHeight: 1.2, ligatures: false, scrollback: 5000 },
      bridge()
    );
    expect(pooled.bound).toBe(false);

    const container = sizedContainer();
    pooled.acquire(container);
    expect(pooled.bound).toBe(true);

    // pty:data feeds the bound slot's xterm.
    const term = (globalThis as Record<string, unknown>).__xtermLast as Stub;
    pooled.feed("hello");
    expect(term.write).toHaveBeenCalledWith("hello");

    pooled.setTheme(theme());
    pooled.focus();
    expect(term.focus).toHaveBeenCalled();

    pooled.release();
    expect(pooled.bound).toBe(false);

    // While dormant, feed lands in the ring (no slot write).
    term.write.mockClear();
    pooled.feed("dormant-bytes");
    expect(term.write).not.toHaveBeenCalled();

    // Re-acquire drains the ring onto the slot.
    pooled.acquire(container);
    expect(term.write).toHaveBeenCalledWith("dormant-bytes");

    pooled.dispose();
    expect(pooled.bound).toBe(false);
  });

  it("onData is a no-op disposer (pooled slots forward keystrokes via the bridge)", () => {
    const provider = new XtermProvider();
    const pooled = provider.acquireLeaf(
      "leaf-2",
      { theme: theme(), fontSize: 13, fontFamily: "mono", lineHeight: 1.2, ligatures: false, scrollback: 5000 },
      bridge()
    );
    const off = pooled.onData(() => {});
    expect(() => off()).not.toThrow();
    pooled.dispose();
  });

  it("onResize subscribes through the session and emits the current size", () => {
    const provider = new XtermProvider();
    const b = bridge();
    const pooled = provider.acquireLeaf(
      "leaf-3",
      { theme: theme(), fontSize: 13, fontFamily: "mono", lineHeight: 1.2, ligatures: false, scrollback: 5000 },
      b
    );
    pooled.acquire(sizedContainer());
    const cb = vi.fn();
    const off = pooled.onResize(cb);
    expect(cb).toHaveBeenCalled();
    off();
    pooled.dispose();
  });

  it("reuses the existing pool config across leaves (does not reconfigure)", () => {
    const provider = new XtermProvider();
    const a = provider.acquireLeaf(
      "leaf-a",
      { theme: theme(), fontSize: 13, fontFamily: "mono", lineHeight: 1.2, ligatures: false, scrollback: 5000 },
      bridge()
    );
    const b = provider.acquireLeaf(
      "leaf-b",
      { theme: theme(), fontSize: 13, fontFamily: "mono", lineHeight: 1.2, ligatures: false, scrollback: 5000 },
      bridge()
    );
    a.acquire(sizedContainer());
    b.acquire(sizedContainer());
    expect(a.bound).toBe(true);
    expect(b.bound).toBe(true);
    a.dispose();
    b.dispose();
  });
});
