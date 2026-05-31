import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { TitleBar } from "./TitleBar";
import { useWorkbench } from "@/state/store";

const startDragging = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging }),
}));

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, quickOpenOpen: false, settingsOpen: false });
  startDragging.mockClear();
});

describe("TitleBar", () => {
  it("renders the titlebar and search trigger", () => {
    renderWithProviders(<TitleBar />);
    expect(screen.getByTestId("titlebar")).toBeInTheDocument();
    expect(screen.getByTestId("titlebar-quickopen")).toBeInTheDocument();
  });

  it("clicking search opens quick open", async () => {
    renderWithProviders(<TitleBar />);
    await userEvent.click(screen.getByTestId("titlebar-quickopen"));
    expect(useWorkbench.getState().quickOpenOpen).toBe(true);
  });

  it("mousedown on the header (not a button) calls startDragging", async () => {
    renderWithProviders(<TitleBar />);
    const header = screen.getByTestId("titlebar");
    // Simulate left mousedown directly on the header element
    header.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    // startDragging is async; wait a tick
    await Promise.resolve();
    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it("mousedown on the search button does not call startDragging", async () => {
    renderWithProviders(<TitleBar />);
    const btn = screen.getByTestId("titlebar-quickopen");
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("clicking settings opens the settings panel", async () => {
    renderWithProviders(<TitleBar />);
    await userEvent.click(screen.getByTestId("titlebar-settings"));
    expect(useWorkbench.getState().settingsOpen).toBe(true);
  });

  it("clicking PrimarySideBar toggle calls togglePrimarySideBar", async () => {
    const before = useWorkbench.getState().layout.primarySideBarVisible;
    renderWithProviders(<TitleBar />);
    await userEvent.click(screen.getByTestId("titlebar-toggle-primarysidebar"));
    expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(!before);
  });

  it("clicking AuxiliaryBar toggle calls toggleAuxiliaryBar", async () => {
    const before = useWorkbench.getState().layout.auxiliaryBarVisible;
    renderWithProviders(<TitleBar />);
    await userEvent.click(screen.getByTestId("titlebar-toggle-auxiliarybar"));
    expect(useWorkbench.getState().layout.auxiliaryBarVisible).toBe(!before);
  });

  it("startDrag silently swallows errors when getCurrentWindow rejects", async () => {
    startDragging.mockRejectedValueOnce(new Error("no Tauri"));
    renderWithProviders(<TitleBar />);
    const header = screen.getByTestId("titlebar");
    header.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 0));
    // No assertion needed — just verify no unhandled rejection
  });

  it("clicking Panel toggle calls togglePanel", async () => {
    const before = useWorkbench.getState().layout.panelVisible;
    renderWithProviders(<TitleBar />);
    await userEvent.click(screen.getByTestId("titlebar-toggle-panel"));
    expect(useWorkbench.getState().layout.panelVisible).toBe(!before);
  });

  it("renders WorkspaceBadges for open workspaces", () => {
    useWorkbench.setState({
      workspaces: [{
        id: "ws-x", projectId: "p", branch: "main", agentBackend: "claude",
        worktreePath: "/wt", status: "active", sessionId: "s", title: "main",
      }],
    });
    renderWithProviders(<TitleBar />);
    expect(screen.getByTestId("workspace-badge-ws-x")).toBeInTheDocument();
  });

  describe("below the responsive breakpoint", () => {
    const realMatchMedia = window.matchMedia;
    beforeEach(() => {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: vi.fn(() => ({
          matches: false,
          media: "",
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      });
    });
    afterEach(() => {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: realMatchMedia,
      });
    });

    it("toggle reveals the collapsed side bar without hiding visibility", async () => {
      useWorkbench.setState({
        layout: { ...initial.layout, primarySideBarVisible: true },
      });
      renderWithProviders(<TitleBar />);
      // After mount the effect collapses (matches:false → below breakpoint).
      expect(useWorkbench.getState().layout.activitybarCollapsed).toBe(true);
      await userEvent.click(screen.getByTestId("titlebar-toggle-primarysidebar"));
      expect(useWorkbench.getState().layout.activitybarCollapsed).toBe(false);
      expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(true);
    });

    it("toggle reveals a collapsed and hidden side bar", async () => {
      useWorkbench.setState({
        layout: { ...initial.layout, primarySideBarVisible: false },
      });
      renderWithProviders(<TitleBar />);
      await userEvent.click(screen.getByTestId("titlebar-toggle-primarysidebar"));
      expect(useWorkbench.getState().layout.activitybarCollapsed).toBe(false);
      expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(true);
    });
  });
});
