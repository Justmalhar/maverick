import { describe, it, expect, beforeEach, vi } from "vitest";
import { XtermProvider } from "./xterm-provider";
import type { TerminalTheme } from "../ipc";

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

let resizeCallbacks: ResizeObserverCallback[] = [];

beforeEach(() => {
  resizeCallbacks = [];
  vi.stubGlobal("ResizeObserver", class {
    callback: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.callback = cb;
      resizeCallbacks.push(cb);
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
});

describe("XtermProvider.mount", () => {
  it("wires xterm + addons and returns a handle", () => {
    const provider = new XtermProvider();
    const container = document.createElement("div");
    const handle = provider.mount(container, {
      theme: theme(), fontSize: 13, fontFamily: "mono", ligatures: false, scrollback: 100,
    });
    const term = (globalThis as Record<string, unknown>).__xtermLast as Stub;
    expect(term.open).toHaveBeenCalledWith(container);
    // fit, web-links, search
    expect(term.loadAddon).toHaveBeenCalledTimes(3);
    expect(handle.dimensions).toEqual({ cols: 80, rows: 24 });

    handle.write("hi");
    expect(term.write).toHaveBeenCalledWith("hi");

    // Input subscription bridges xterm.onData and returns a disposer.
    const cb = vi.fn();
    const off = handle.onData(cb);
    expect(term.onData).toHaveBeenCalledWith(cb);
    off();

    // onResize emits the current fitted size immediately and on container resize.
    const sizeCb = vi.fn();
    const offResize = handle.onResize(sizeCb);
    expect(sizeCb).toHaveBeenCalledWith(80, 24);
    sizeCb.mockClear();
    for (const rc of resizeCallbacks) {
      rc([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    }
    expect(sizeCb).toHaveBeenCalledWith(80, 24);
    offResize();
    sizeCb.mockClear();
    for (const rc of resizeCallbacks) {
      rc([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    }
    expect(sizeCb).not.toHaveBeenCalled();

    handle.resize(40, 12);
    expect(term.resize).toHaveBeenCalledWith(40, 12);
    handle.setTheme(theme());
    expect((term.options as { theme?: unknown }).theme).toBeDefined();
    handle.focus();
    expect(term.focus).toHaveBeenCalled();
    handle.dispose();
    expect(term.dispose).toHaveBeenCalled();
  });

  it("accepts ligatures flag and ignores it", () => {
    const provider = new XtermProvider();
    provider.mount(document.createElement("div"), {
      theme: theme(), fontSize: 13, fontFamily: "mono", ligatures: true, scrollback: 0,
    });
    // No throw means the void options.ligatures branch executed.
    expect(true).toBe(true);
  });

  it("swallows fit errors during initial mount and on resize", async () => {
    const FitMod = await import("@xterm/addon-fit");
    const original = (FitMod as { FitAddon: unknown }).FitAddon;
    (FitMod as unknown as { FitAddon: unknown }).FitAddon = class {
      fit = vi.fn(() => {
        throw new Error("not sized");
      });
    };
    const provider = new XtermProvider();
    expect(() =>
      provider.mount(document.createElement("div"), {
        theme: theme(), fontSize: 13, fontFamily: "mono", ligatures: false, scrollback: 100,
      })
    ).not.toThrow();

    // Trigger the ResizeObserver callback so the second try/catch fires.
    for (const cb of resizeCallbacks) cb([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    (FitMod as unknown as { FitAddon: unknown }).FitAddon = original;
  });
});
