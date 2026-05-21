import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { Workbench } from "./Workbench";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
  useWorkbench.setState({
    ...initial,
    workspaces: [], projects: [], activeWorkspaceId: null,
    commandPaletteOpen: false, quickOpenOpen: false, presetLauncherOpen: false, settingsOpen: false,
    layout: { ...initial.layout, primarySideBarVisible: true, auxiliaryBarVisible: true, panelVisible: true },
  });
});

describe("Workbench", () => {
  it("renders the full Workbench shell with both sidebars and bottom panel", async () => {
    renderWithProviders(<Workbench />);
    expect(screen.getByTestId("workbench")).toBeInTheDocument();
    expect(screen.getByTestId("titlebar")).toBeInTheDocument();
    expect(screen.getByTestId("primarysidebar-panel")).toBeInTheDocument();
    expect(screen.getByTestId("auxiliarybar-panel")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("bottom-panel")).toBeInTheDocument());
  });

  it("hides primary sidebar and bottom panel when toggled off", () => {
    useWorkbench.setState({
      ...initial,
      layout: { ...initial.layout, primarySideBarVisible: false, panelVisible: false, auxiliaryBarVisible: false },
    });
    renderWithProviders(<Workbench />);
    expect(screen.queryByTestId("primarysidebar-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bottom-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("auxiliarybar-panel")).not.toBeInTheDocument();
  });

  it("lazy-renders settings panel when settings is open and closes via Escape", async () => {
    useWorkbench.setState({ ...initial, settingsOpen: true });
    renderWithProviders(<Workbench />);
    await waitFor(() => expect(screen.getByTestId("settings-panel")).toBeInTheDocument());
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => expect(useWorkbench.getState().settingsOpen).toBe(false));
  });
});
