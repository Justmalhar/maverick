import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import { TerminalPane } from "./TerminalPane";
import { TerminalRegistry, type TerminalProvider, type TerminalHandle } from "@/lib/terminal-provider";

interface Handle extends TerminalHandle {
  write: ReturnType<typeof vi.fn>;
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

  it("isFocused branch applies the focused ring class", () => {
    const { provider } = makeProvider();
    TerminalRegistry.register(provider);
    renderWithProviders(<TerminalPane ptyId="p1" paneId="pane-2" isFocused onFocus={() => {}} />);
    expect(screen.getByTestId("terminal-pane-pane-2").className).toMatch(/ring-primary/);
  });
});
