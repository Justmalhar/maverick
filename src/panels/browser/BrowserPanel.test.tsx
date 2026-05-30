import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, fireEvent, waitFor, act } from "@/test/utils";
import BrowserPanel from "./BrowserPanel";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

let capturedHandlers: Array<(p: { selector: string; text: string; html: string }) => void>;

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
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

describe("BrowserPanel", () => {
  it("opens the native webview on mount and renders the toolbar", async () => {
    renderWithProviders(<BrowserPanel />);
    expect(screen.getByTestId("browser-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("browser-host")).toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_open", expect.objectContaining({ url: "http://localhost:3000" })));
  });

  it("navigates via the URL bar and pushes history", async () => {
    renderWithProviders(<BrowserPanel />);
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "example.com" } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_navigate", { url: "https://example.com" })
    );
    // Back becomes enabled after navigating.
    expect(screen.getByTestId("browser-back")).not.toBeDisabled();
  });

  it("blank URL navigation is a no-op", async () => {
    renderWithProviders(<BrowserPanel />);
    vi.mocked(invoke).mockClear();
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "   " } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    expect(invoke).not.toHaveBeenCalledWith("browser_navigate", expect.anything());
  });

  it("https URLs are not re-prefixed", async () => {
    renderWithProviders(<BrowserPanel />);
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "https://already.example" } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_navigate", { url: "https://already.example" })
    );
  });

  it("back and forward re-navigate through history", async () => {
    renderWithProviders(<BrowserPanel />);
    expect(screen.getByTestId("browser-back")).toBeDisabled();

    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "a.com" } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("browser-back")).not.toBeDisabled());

    await userEvent.click(screen.getByTestId("browser-back"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_navigate", { url: "http://localhost:3000" })
    );
    await userEvent.click(screen.getByTestId("browser-forward"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_navigate", { url: "https://a.com" })
    );
  });

  it("refresh and stop eval into the webview", async () => {
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
    renderWithProviders(<BrowserPanel />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_open", expect.anything()));

    act(() => useWorkbench.setState({ ...useWorkbench.getState(), settingsOpen: true }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_hide"));
    expect(screen.getByTestId("browser-overlay-note")).toHaveTextContent("Browser hidden");

    act(() => useWorkbench.setState({ ...useWorkbench.getState(), settingsOpen: false }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_show"));
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

  it("closes the native webview on unmount", async () => {
    const { unmount } = renderWithProviders(<BrowserPanel />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_open", expect.anything()));
    unmount();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_close"));
  });

  it("logs an error when the native open fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "browser_open") return Promise.reject(new Error("no main window"));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<BrowserPanel />);
    await waitFor(() => expect(errSpy).toHaveBeenCalledWith("browser open failed", expect.any(Error)));
    errSpy.mockRestore();
  });

  it("re-pins the webview bounds on window resize", async () => {
    renderWithProviders(<BrowserPanel />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_open", expect.anything()));
    vi.mocked(invoke).mockClear();
    act(() => window.dispatchEvent(new Event("resize")));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_set_bounds", expect.any(Object)));
  });

  it("swallows native errors from fire-and-forget calls", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "browser_set_bounds") return Promise.reject(new Error("gone"));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<BrowserPanel />);
    // Firing resize triggers a rejecting set_bounds; the swallow handler keeps it quiet.
    act(() => window.dispatchEvent(new Event("resize")));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_set_bounds", expect.any(Object)));
  });

  it("logs an error when navigation fails", async () => {
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

  it("maverick:browser:toggleInspect event triggers toggleInspect", async () => {
    renderWithProviders(<BrowserPanel />);
    // First dispatch — should enable the inspector
    act(() => window.dispatchEvent(new CustomEvent("maverick:browser:toggleInspect")));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_eval",
        { script: expect.stringContaining("__mvInspect && window.__mvInspect.enable()") }
      )
    );
    // Second dispatch — should disable the inspector
    act(() => window.dispatchEvent(new CustomEvent("maverick:browser:toggleInspect")));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_eval",
        { script: expect.stringContaining("__mvInspect && window.__mvInspect.disable()") }
      )
    );
  });

  it("captures an element with no text without adding a comment suffix", async () => {
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
