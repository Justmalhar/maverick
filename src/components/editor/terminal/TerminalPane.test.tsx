import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import { TerminalPane } from "./TerminalPane";
import {
  TerminalRegistry,
  type TerminalProvider,
  type TerminalHandle,
  type PooledTerminalHandle,
  type PtyBridge,
} from "@/lib/terminal-provider";

interface Handle extends TerminalHandle {
  write: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onResize: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  setTheme: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

let resizeObservers: ResizeObserverCallback[] = [];

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(listen).mockReset().mockResolvedValue(() => {});
  resizeObservers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.callback = cb;
        resizeObservers.push(cb);
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});

function makeProvider(): { provider: TerminalProvider; mountedHandle: Handle } {
  const handle: Handle = {
    write: vi.fn(),
    onData: vi.fn(() => () => {}), onResize: vi.fn(() => () => {}),
    resize: vi.fn(),
    setTheme: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    get dimensions() {
      return { cols: 80, rows: 24 };
    },
  };
  const provider: TerminalProvider = {
    mount: () => handle,
  };
  return { provider, mountedHandle: handle };
}

describe("TerminalPane", () => {
  it("mounts the terminal once, listens for clear, and disposes on unmount", () => {
    const { provider, mountedHandle } = makeProvider();
    TerminalRegistry.register(provider);
    const onFocus = vi.fn();
    const { unmount } = renderWithProviders(
      <TerminalPane ptyId="p1" paneId="pane-1" isFocused={false} onFocus={onFocus} />
    );
    expect(screen.getByTestId("terminal-pane-pane-1")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("terminal-pane-pane-1"));
    expect(onFocus).toHaveBeenCalledWith("pane-1");

    window.dispatchEvent(new CustomEvent("maverick:terminal:clear"));
    expect(mountedHandle.write).toHaveBeenCalledWith("\x1b[2J\x1b[H");

    // Trigger ResizeObserver to exercise resize math + catch path
    for (const cb of resizeObservers) {
      cb([{ contentRect: { width: 800, height: 340 } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    }

    unmount();
    expect(mountedHandle.dispose).toHaveBeenCalled();
  });

  it("pipes user keystrokes back to the PTY via pty_write and taps onData", async () => {
    const { provider, mountedHandle } = makeProvider();
    TerminalRegistry.register(provider);
    const onData = vi.fn();
    renderWithProviders(
      <TerminalPane ptyId="p9" paneId="pane-k" isFocused onFocus={() => {}} onData={onData} />
    );

    // The pane subscribes to terminal input on mount.
    expect(mountedHandle.onData).toHaveBeenCalled();
    const inputCb = mountedHandle.onData.mock.calls[0][0] as (d: string) => void;
    inputCb("ls\r");

    expect(onData).toHaveBeenCalledWith("ls\r");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "p9", data: "ls\r" })
    );
  });

  it("focuses on mount and again when it becomes the active pane", () => {
    const { provider, mountedHandle } = makeProvider();
    TerminalRegistry.register(provider);
    const { rerender } = renderWithProviders(
      <TerminalPane ptyId="p11" paneId="pane-foc" isFocused={false} onFocus={() => {}} />
    );
    // Auto-focus on mount so the terminal is typeable without clicking.
    expect(mountedHandle.focus).toHaveBeenCalledTimes(1);

    rerender(<TerminalPane ptyId="p11" paneId="pane-foc" isFocused onFocus={() => {}} />);
    expect(mountedHandle.focus).toHaveBeenCalledTimes(2);
  });

  it("resizes the PTY to the renderer's fitted grid size", async () => {
    const { provider, mountedHandle } = makeProvider();
    TerminalRegistry.register(provider);
    renderWithProviders(<TerminalPane ptyId="p10" paneId="pane-r" isFocused onFocus={() => {}} />);

    expect(mountedHandle.onResize).toHaveBeenCalled();
    const resizeCb = mountedHandle.onResize.mock.calls[0][0] as (c: number, r: number) => void;
    resizeCb(120, 40);

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_resize", { ptyId: "p10", cols: 120, rows: 40 })
    );
  });

  it("isFocused branch applies the focused ring class", () => {
    const { provider } = makeProvider();
    TerminalRegistry.register(provider);
    renderWithProviders(<TerminalPane ptyId="p1" paneId="pane-2" isFocused onFocus={() => {}} />);
    expect(screen.getByTestId("terminal-pane-pane-2").className).toMatch(/ring-primary/);
  });
});

interface PooledStub extends PooledTerminalHandle {
  acquire: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  feed: ReturnType<typeof vi.fn>;
  onResize: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function makePooledProvider(): {
  provider: TerminalProvider;
  pooled: PooledStub;
  acquireLeaf: ReturnType<typeof vi.fn>;
  lastBridge: () => PtyBridge | undefined;
} {
  let bound = false;
  const pooled: PooledStub = {
    acquire: vi.fn(() => {
      bound = true;
    }),
    release: vi.fn(() => {
      bound = false;
    }),
    feed: vi.fn(),
    onData: vi.fn(() => () => {}),
    // Invoke the subscriber immediately so the pane's resize→PTY wiring runs.
    onResize: vi.fn((cb: (c: number, r: number) => void) => {
      cb(100, 30);
      return () => {};
    }),
    setTheme: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    get bound() {
      return bound;
    },
  };
  let captured: PtyBridge | undefined;
  const acquireLeaf = vi.fn((_leafId: string, _opts: unknown, bridge: PtyBridge) => {
    captured = bridge;
    return pooled;
  });
  const provider: TerminalProvider = {
    mount: () => {
      throw new Error("pooled provider should not call mount");
    },
    acquireLeaf,
  };
  return { provider, pooled, acquireLeaf, lastBridge: () => captured };
}

describe("TerminalPane (pooled renderer path)", () => {
  const previous = TerminalRegistry.get();
  afterEach(() => {
    TerminalRegistry.register(previous);
  });

  it("acquires a pooled slot when visible and routes pty:data to feed", async () => {
    const callbacks: Record<string, (e: { payload: unknown }) => void> = {};
    vi.mocked(listen).mockImplementation((async (event: string, cb: (e: { payload: unknown }) => void) => {
      callbacks[event] = cb;
      return () => {};
    }) as unknown as typeof listen);

    const { provider, pooled, acquireLeaf } = makePooledProvider();
    TerminalRegistry.register(provider);
    renderWithProviders(
      <TerminalPane ptyId="p1" paneId="leaf-1" isFocused onFocus={() => {}} visible />
    );
    expect(acquireLeaf).toHaveBeenCalledWith("leaf-1", expect.any(Object), expect.any(Object));
    expect(pooled.acquire).toHaveBeenCalled();
    expect(pooled.focus).toHaveBeenCalled();

    await Promise.resolve();
    callbacks["pty:data"]({ payload: { ptyId: "p1", data: "out" } });
    expect(pooled.feed).toHaveBeenCalledWith("out");
  });

  it("the bridge forwards keystrokes, resizes, and SIGWINCH kicks to the PTY", async () => {
    const { provider, lastBridge } = makePooledProvider();
    TerminalRegistry.register(provider);
    const onData = vi.fn();
    renderWithProviders(
      <TerminalPane ptyId="p2" paneId="leaf-2" isFocused onFocus={() => {}} visible onData={onData} />
    );
    const bridge = lastBridge()!;
    bridge.writeToPty("ls\r");
    bridge.resizePty(120, 40);
    bridge.kickPty(120, 40);
    expect(onData).toHaveBeenCalledWith("ls\r");
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "p2", data: "ls\r" });
      expect(invoke).toHaveBeenCalledWith("pty_resize", { ptyId: "p2", cols: 120, rows: 40 });
      expect(invoke).toHaveBeenCalledWith("pty_resize", { ptyId: "p2", cols: 120, rows: 41 });
    });
  });

  it("clear event feeds the reset sequence to the pooled slot", () => {
    const { provider, pooled } = makePooledProvider();
    TerminalRegistry.register(provider);
    renderWithProviders(
      <TerminalPane ptyId="p3" paneId="leaf-3" isFocused onFocus={() => {}} visible />
    );
    window.dispatchEvent(new CustomEvent("maverick:terminal:clear"));
    expect(pooled.feed).toHaveBeenCalledWith("\x1b[2J\x1b[H");
  });

  it("releases the slot when scrolled out of the live window and re-acquires on return", () => {
    const { provider, pooled } = makePooledProvider();
    TerminalRegistry.register(provider);
    const { rerender } = renderWithProviders(
      <TerminalPane ptyId="p4" paneId="leaf-4" isFocused={false} onFocus={() => {}} visible />
    );
    pooled.acquire.mockClear();
    rerender(<TerminalPane ptyId="p4" paneId="leaf-4" isFocused={false} onFocus={() => {}} visible={false} />);
    expect(pooled.release).toHaveBeenCalled();
    rerender(<TerminalPane ptyId="p4" paneId="leaf-4" isFocused={false} onFocus={() => {}} visible />);
    expect(pooled.acquire).toHaveBeenCalled();
  });

  it("does not acquire on mount while hidden, and disposes the session on unmount", () => {
    const { provider, pooled } = makePooledProvider();
    TerminalRegistry.register(provider);
    const { unmount } = renderWithProviders(
      <TerminalPane ptyId="p5" paneId="leaf-5" isFocused={false} onFocus={() => {}} visible={false} />
    );
    expect(pooled.acquire).not.toHaveBeenCalled();
    unmount();
    expect(pooled.dispose).toHaveBeenCalled();
  });

  it("refocuses the pooled slot when it becomes the active pane", () => {
    const { provider, pooled } = makePooledProvider();
    TerminalRegistry.register(provider);
    const { rerender } = renderWithProviders(
      <TerminalPane ptyId="p6" paneId="leaf-6" isFocused={false} onFocus={() => {}} visible />
    );
    pooled.focus.mockClear();
    rerender(<TerminalPane ptyId="p6" paneId="leaf-6" isFocused onFocus={() => {}} visible />);
    expect(pooled.focus).toHaveBeenCalled();
  });
});
