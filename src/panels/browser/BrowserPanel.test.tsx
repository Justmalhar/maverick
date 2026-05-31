import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { renderWithProviders, screen, fireEvent, waitFor, act } from "@/test/utils";
import BrowserPanel from "./BrowserPanel";
import { useWorkbench } from "@/state/store";
import { useSettingsStore, _resetSettingsStoreForTests } from "@/lib/stores/settings";

const initial = useWorkbench.getState();

let capturedHandlers: Array<(p: { selector: string; text: string; html: string }) => void>;

function useNativeEngine() {
  useSettingsStore.setState({ values: { "browser.engine": "native" }, status: "idle", lastError: null });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(shellOpen).mockClear();
  _resetSettingsStoreForTests();
  capturedHandlers = [];
  vi.mocked(listen).mockReset().mockImplementation((async (event: string, cb: (e: { payload: unknown }) => void) => {
    if (event === "browser://captured") {
      capturedHandlers.push((p) => cb({ payload: p }));
    }
    return () => {};
  }) as unknown as typeof listen);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  useWorkbench.setState({
    ...initial,
    settingsOpen: false,
    quickOpenOpen: false,
    commandPaletteOpen: false,
    presetLauncherOpen: false,
    keybindingHelpOpen: false,
    projectSettings: { open: false, projectId: null },
  });
});

describe("BrowserPanel — iframe engine (default)", () => {
  it("renders the sandboxed iframe preview, not the native host", () => {
    renderWithProviders(<BrowserPanel />);
    expect(screen.getByTestId("browser-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("browser-preview")).toBeInTheDocument();
    expect(screen.getByTestId("browser-iframe")).toHaveAttribute("src", "http://localhost:3000");
    // No native webview commands are issued in iframe mode.
    expect(invoke).not.toHaveBeenCalledWith("browser_open", expect.anything());
  });

  it("the iframe sandbox omits allow-top-navigation", () => {
    renderWithProviders(<BrowserPanel />);
    const sandbox = screen.getByTestId("browser-iframe").getAttribute("sandbox") ?? "";
    expect(sandbox).not.toMatch(/allow-top-navigation/);
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
  });

  it("navigating updates the iframe src and pushes history without native calls", async () => {
    renderWithProviders(<BrowserPanel />);
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "example.com" } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByTestId("browser-iframe")).toHaveAttribute("src", "https://example.com")
    );
    expect(screen.getByTestId("browser-back")).not.toBeDisabled();
    expect(invoke).not.toHaveBeenCalledWith("browser_navigate", expect.anything());
  });

  it("blank URL navigation is a no-op", () => {
    renderWithProviders(<BrowserPanel />);
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "   " } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    expect(screen.getByTestId("browser-iframe")).toHaveAttribute("src", "http://localhost:3000");
  });

  it("back and forward replay history into the iframe", async () => {
    renderWithProviders(<BrowserPanel />);
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "a.com" } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("browser-back")).not.toBeDisabled());

    await userEvent.click(screen.getByTestId("browser-back"));
    await waitFor(() =>
      expect(screen.getByTestId("browser-iframe")).toHaveAttribute("src", "http://localhost:3000")
    );
    await userEvent.click(screen.getByTestId("browser-forward"));
    await waitFor(() =>
      expect(screen.getByTestId("browser-iframe")).toHaveAttribute("src", "https://a.com")
    );
  });

  it("back at history start and forward at history end are no-ops", async () => {
    renderWithProviders(<BrowserPanel />);
    // Back is disabled at the start.
    expect(screen.getByTestId("browser-back")).toBeDisabled();
    expect(screen.getByTestId("browser-forward")).toBeDisabled();
  });

  it("refresh remounts the iframe via a changed key", async () => {
    renderWithProviders(<BrowserPanel />);
    const before = screen.getByTestId("browser-iframe");
    await userEvent.click(screen.getByTestId("browser-refresh"));
    await waitFor(() => {
      // Same src, but React replaced the node because the key changed.
      expect(screen.getByTestId("browser-iframe")).not.toBe(before);
    });
  });

  it("stop is a no-op in iframe mode (no native eval)", async () => {
    renderWithProviders(<BrowserPanel />);
    await userEvent.click(screen.getByTestId("browser-stop"));
    expect(invoke).not.toHaveBeenCalledWith("browser_eval", expect.anything());
  });

  it("inspect toggle does not eval the native inspector in iframe mode", async () => {
    renderWithProviders(<BrowserPanel />);
    await userEvent.click(screen.getByTestId("browser-inspect"));
    expect(invoke).not.toHaveBeenCalledWith("browser_eval", expect.anything());
  });

  it("hides (not unmounts) the iframe while a modal overlay is open", async () => {
    renderWithProviders(<BrowserPanel />);
    expect(screen.getByTestId("browser-preview")).toHaveStyle({ visibility: "visible" });
    act(() => useWorkbench.setState({ ...useWorkbench.getState(), settingsOpen: true }));
    await waitFor(() =>
      expect(screen.getByTestId("browser-preview")).toHaveStyle({ visibility: "hidden" })
    );
  });

  it("opening a remote URL surfaces the X-Frame-Options hint with an external-open action", async () => {
    renderWithProviders(<BrowserPanel />);
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "https://example.com" } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("browser-xfo-hint")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("browser-open-external"));
    await waitFor(() => expect(shellOpen).toHaveBeenCalledWith("https://example.com"));
  });

  it("local URLs do not show the X-Frame-Options hint", () => {
    renderWithProviders(<BrowserPanel />);
    expect(screen.queryByTestId("browser-xfo-hint")).not.toBeInTheDocument();
  });

  it("logs when an external-open fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(shellOpen).mockRejectedValueOnce(new Error("no opener"));
    renderWithProviders(<BrowserPanel />);
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "https://example.com" } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("browser-open-external")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("browser-open-external"));
    await waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith("browser open external failed", expect.any(Error))
    );
    errSpy.mockRestore();
  });

  it("does not open a native webview on unmount in iframe mode", () => {
    const { unmount } = renderWithProviders(<BrowserPanel />);
    unmount();
    expect(invoke).not.toHaveBeenCalledWith("browser_close");
  });

  it("forwards captured elements to the input bar", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    renderWithProviders(<BrowserPanel />);
    await waitFor(() => expect(capturedHandlers.length).toBeGreaterThan(0));
    act(() => capturedHandlers[0]({ selector: "div.card > button", text: "Buy", html: "<button/>" }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "maverick:input-append" })
    );
    dispatchSpy.mockRestore();
  });

  it("captured element with no text omits the comment suffix", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    renderWithProviders(<BrowserPanel />);
    await waitFor(() => expect(capturedHandlers.length).toBeGreaterThan(0));
    act(() => capturedHandlers[0]({ selector: "main", text: "", html: "<main/>" }));
    const call = dispatchSpy.mock.calls.find(
      (c) => (c[0] as CustomEvent).type === "maverick:input-append"
    );
    expect((call?.[0] as CustomEvent).detail.text).toBe("@selector:main ");
    dispatchSpy.mockRestore();
  });
});

describe("BrowserPanel — keep-alive (visible prop)", () => {
  it("renders hidden when visible=false without unmounting", () => {
    renderWithProviders(<BrowserPanel visible={false} />);
    expect(screen.getByTestId("browser-preview")).toHaveStyle({ visibility: "hidden" });
  });

  it("native engine hides (not closes) when the tab goes inactive, shows on return", async () => {
    useNativeEngine();
    const { rerender } = renderWithProviders(<BrowserPanel visible={true} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_open", expect.anything()));

    rerender(<BrowserPanel visible={false} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_hide"));
    // It must NOT close on a tab switch.
    expect(invoke).not.toHaveBeenCalledWith("browser_close");

    rerender(<BrowserPanel visible={true} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_show"));
  });
});

describe("BrowserPanel — native engine (opt-in)", () => {
  it("opens the native webview on mount and renders the native host", async () => {
    useNativeEngine();
    renderWithProviders(<BrowserPanel />);
    expect(screen.getByTestId("browser-host")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-iframe")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_open",
        expect.objectContaining({ url: "http://localhost:3000" })
      )
    );
  });

  it("navigates via browser_navigate and pushes history", async () => {
    useNativeEngine();
    renderWithProviders(<BrowserPanel />);
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "example.com" } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_navigate", { url: "https://example.com" })
    );
    expect(screen.getByTestId("browser-back")).not.toBeDisabled();
  });

  it("refresh and stop eval into the native webview", async () => {
    useNativeEngine();
    renderWithProviders(<BrowserPanel />);
    await userEvent.click(screen.getByTestId("browser-refresh"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_eval", { script: "location.reload()" })
    );
    await userEvent.click(screen.getByTestId("browser-stop"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_eval", { script: "window.stop()" })
    );
  });

  it("toggling inspect enables then disables the injected inspector", async () => {
    useNativeEngine();
    renderWithProviders(<BrowserPanel />);
    await userEvent.click(screen.getByTestId("browser-inspect"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_eval",
        { script: expect.stringContaining("__mvInspect && window.__mvInspect.enable()") }
      )
    );
    await userEvent.click(screen.getByTestId("browser-inspect"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_eval",
        { script: expect.stringContaining("__mvInspect && window.__mvInspect.disable()") }
      )
    );
  });

  it("hides the webview while a modal overlay is open and shows it again after", async () => {
    useNativeEngine();
    renderWithProviders(<BrowserPanel />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_open", expect.anything()));

    act(() => useWorkbench.setState({ ...useWorkbench.getState(), settingsOpen: true }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_hide"));
    expect(screen.getByTestId("browser-overlay-note")).toHaveTextContent("Browser hidden");

    act(() => useWorkbench.setState({ ...useWorkbench.getState(), settingsOpen: false }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_show"));
  });

  it("closes the native webview on unmount", async () => {
    useNativeEngine();
    const { unmount } = renderWithProviders(<BrowserPanel />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_open", expect.anything()));
    unmount();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_close"));
  });

  it("logs an error when the native open fails", async () => {
    useNativeEngine();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "browser_open") return Promise.reject(new Error("no main window"));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<BrowserPanel />);
    await waitFor(() => expect(errSpy).toHaveBeenCalledWith("browser open failed", expect.any(Error)));
    errSpy.mockRestore();
  });

  it("logs an error when native navigation fails", async () => {
    useNativeEngine();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "browser_navigate") return Promise.reject(new Error("nav fail"));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<BrowserPanel />);
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "fails.example" } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    await waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith("browser navigate failed", expect.any(Error))
    );
    errSpy.mockRestore();
  });

  it("re-pins the webview bounds on window resize", async () => {
    useNativeEngine();
    renderWithProviders(<BrowserPanel />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_open", expect.anything()));
    vi.mocked(invoke).mockClear();
    act(() => window.dispatchEvent(new Event("resize")));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_set_bounds", expect.any(Object))
    );
  });

  it("swallows native errors from fire-and-forget calls", async () => {
    useNativeEngine();
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "browser_set_bounds") return Promise.reject(new Error("gone"));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<BrowserPanel />);
    act(() => window.dispatchEvent(new Event("resize")));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_set_bounds", expect.any(Object))
    );
  });

  it("the global toggleInspect event drives the native inspector", async () => {
    useNativeEngine();
    renderWithProviders(<BrowserPanel />);
    act(() => window.dispatchEvent(new CustomEvent("maverick:browser:toggleInspect")));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_eval",
        { script: expect.stringContaining("__mvInspect && window.__mvInspect.enable()") }
      )
    );
    act(() => window.dispatchEvent(new CustomEvent("maverick:browser:toggleInspect")));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_eval",
        { script: expect.stringContaining("__mvInspect && window.__mvInspect.disable()") }
      )
    );
  });
});
