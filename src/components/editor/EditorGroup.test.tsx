import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { EditorGroup } from "./EditorGroup";
import { useWorkbench } from "@/state/store";
import { useSettingsStore, _resetSettingsStoreForTests } from "@/lib/stores/settings";
import { makeWorkspace } from "@/test/fixtures";

vi.mock("./terminal/TerminalPane", () => ({
  TerminalPane: ({
    ptyId,
    paneId,
    onFocus,
  }: {
    ptyId: string;
    paneId: string;
    onFocus: (paneId: string) => void;
  }) => (
    <button
      data-testid={`mock-terminal-pane-${paneId}`}
      data-pty={ptyId}
      onClick={() => onFocus(paneId)}
    />
  ),
}));

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
  _resetSettingsStoreForTests();
  useWorkbench.setState({
    ...initial, workspaces: [], activeWorkspaceId: null, workspaceAccessOrder: [],
    editorModes: {}, splitTrees: {}, systemTabs: [], activeSystemTab: null,
  });
});

describe("EditorGroup", () => {
  it("shows empty editor when no workspaces", () => {
    renderWithProviders(<EditorGroup />);
    expect(screen.getByTestId("empty-editor")).toBeInTheDocument();
  });

  it("renders one WorkspaceEditor per workspace", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<EditorGroup />);
    expect(screen.getByTestId("workspace-editor-w1")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-editor-w2")).toBeInTheDocument();
  });

  it("suspends least-recently-used workspaces beyond the LRU limit", () => {
    useSettingsStore.setState({
      values: { "advanced.lruLimit": 2 },
      status: "idle",
      lastError: null,
    });
    useWorkbench.setState({
      ...initial,
      workspaces: [
        makeWorkspace({ id: "w1" }),
        makeWorkspace({ id: "w2" }),
        makeWorkspace({ id: "w3" }),
      ],
      // MRU first: w3, w2, w1 → with limit 2, w1 is suspended.
      workspaceAccessOrder: ["w3", "w2", "w1"],
      activeWorkspaceId: "w3",
    });
    renderWithProviders(<EditorGroup />);
    expect(screen.getByTestId("workspace-editor-w3")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-editor-w2")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-editor-w1")).not.toBeInTheDocument();
  });

  it("re-mounts a suspended workspace when it becomes active again", () => {
    useSettingsStore.setState({
      values: { "advanced.lruLimit": 2 },
      status: "idle",
      lastError: null,
    });
    useWorkbench.setState({
      ...initial,
      workspaces: [
        makeWorkspace({ id: "w1" }),
        makeWorkspace({ id: "w2" }),
        makeWorkspace({ id: "w3" }),
      ],
      workspaceAccessOrder: ["w3", "w2", "w1"],
      activeWorkspaceId: "w3",
    });
    const { rerender } = renderWithProviders(<EditorGroup />);
    expect(screen.queryByTestId("workspace-editor-w1")).not.toBeInTheDocument();

    // Activating w1 moves it to the front of the access order → live again.
    useWorkbench.getState().setActiveWorkspace("w1");
    rerender(<EditorGroup />);
    expect(screen.getByTestId("workspace-editor-w1")).toBeInTheDocument();
    // w2 is now the LRU tail and falls out of the window.
    expect(screen.queryByTestId("workspace-editor-w2")).not.toBeInTheDocument();
  });

  it("renders dashboard system tab (UsagePanel)", async () => {
    useWorkbench.setState({ ...initial, systemTabs: ["dashboard"], activeSystemTab: "dashboard", activeWorkspaceId: null });
    renderWithProviders(<EditorGroup />);
    await waitFor(() => expect(screen.getByTestId("usage-panel")).toBeInTheDocument());
  });

  it("renders browser system tab (BrowserPanel)", async () => {
    useWorkbench.setState({ ...initial, systemTabs: ["browser"], activeSystemTab: "browser", activeWorkspaceId: null });
    renderWithProviders(<EditorGroup />);
    await waitFor(() => expect(screen.getByTestId("browser-panel")).toBeInTheDocument());
  });

  it("renders kanban system tab (KanbanBoard)", async () => {
    useWorkbench.setState({ ...initial, systemTabs: ["kanban"], activeSystemTab: "kanban", activeWorkspaceId: null });
    renderWithProviders(<EditorGroup />);
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());
  });

  it("renders automations system tab (AutomationsPanel)", async () => {
    useWorkbench.setState({ ...initial, systemTabs: ["automations"], activeSystemTab: "automations", activeWorkspaceId: null });
    renderWithProviders(<EditorGroup />);
    await waitFor(() => expect(screen.getByTestId("automations-panel")).toBeInTheDocument());
  });

  it("renders mcps system tab (MCPsPanel)", async () => {
    useWorkbench.setState({ ...initial, systemTabs: ["mcps"], activeSystemTab: "mcps", activeWorkspaceId: null });
    renderWithProviders(<EditorGroup />);
    await waitFor(() => expect(screen.getByTestId("mcps-panel")).toBeInTheDocument());
  });

  it("keeps the browser mounted (hidden) when another system tab is active", async () => {
    useWorkbench.setState({
      ...initial,
      systemTabs: ["browser", "kanban"],
      activeSystemTab: "kanban",
      activeWorkspaceId: null,
    });
    renderWithProviders(<EditorGroup />);
    // The active kanban tab renders…
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());
    // …while the browser stays in the DOM (keep-alive), just hidden.
    const browser = await screen.findByTestId("browser-panel");
    expect(browser).toBeInTheDocument();
    expect(browser.closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "true");
  });

  it("does not mount the browser when its tab is not open", () => {
    useWorkbench.setState({
      ...initial,
      systemTabs: ["kanban"],
      activeSystemTab: "kanban",
      activeWorkspaceId: null,
    });
    renderWithProviders(<EditorGroup />);
    expect(screen.queryByTestId("browser-panel")).not.toBeInTheDocument();
  });

  it("renders a terminal pane for each terminal tab; only the active one is visible", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [],
      activeWorkspaceId: null,
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [
        { id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" },
        { id: "t2", cwd: "/b", title: "b", ptyId: "pty-2" },
      ],
      activeTerminalTabId: "t1",
    });
    renderWithProviders(<EditorGroup />);
    const active = screen.getByTestId("terminal-tab-content-t1");
    const inactive = screen.getByTestId("terminal-tab-content-t2");
    expect(active).toHaveAttribute("aria-hidden", "false");
    expect(inactive).toHaveAttribute("aria-hidden", "true");
  });

  it("shows a Starting placeholder for a pending terminal tab (no ptyId yet)", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [],
      activeWorkspaceId: null,
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [{ id: "t1", cwd: "/a", title: "a", ptyId: "" }],
      activeTerminalTabId: "t1",
    });
    renderWithProviders(<EditorGroup />);
    expect(screen.getByTestId("terminal-tab-starting-t1")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-terminal-pane-t1")).not.toBeInTheDocument();
  });

  it("focusing a terminal pane activates its tab", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [],
      activeWorkspaceId: null,
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [
        { id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" },
        { id: "t2", cwd: "/b", title: "b", ptyId: "pty-2" },
      ],
      activeTerminalTabId: "t1",
    });
    renderWithProviders(<EditorGroup />);
    await userEvent.click(screen.getByTestId("mock-terminal-pane-t2"));
    expect(useWorkbench.getState().activeTerminalTabId).toBe("t2");
  });

  it("does not show the empty editor when only a terminal tab is open", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [],
      activeWorkspaceId: null,
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [{ id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" }],
      activeTerminalTabId: "t1",
    });
    renderWithProviders(<EditorGroup />);
    expect(screen.queryByTestId("empty-editor")).not.toBeInTheDocument();
  });
});
