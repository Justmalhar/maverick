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
    fileTabs: [], activeFileTabId: null, fileTabAccessOrder: [],
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

  it("renders skills system tab (SkillsPanel)", async () => {
    useWorkbench.setState({ ...initial, systemTabs: ["skills"], activeSystemTab: "skills", activeWorkspaceId: null });
    renderWithProviders(<EditorGroup />);
    await waitFor(() => expect(screen.getByTestId("skills-panel")).toBeInTheDocument());
  });

  it("renders skill-editor system tab (SkillEditorPanel)", async () => {
    useWorkbench.setState({ ...initial, systemTabs: ["skill-editor"], activeSystemTab: "skill-editor", activeWorkspaceId: null });
    renderWithProviders(<EditorGroup />);
    await waitFor(() => expect(screen.getByTestId("skill-editor-panel")).toBeInTheDocument());
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

describe("file tabs", () => {
  it("mounts a pane per file tab, hidden when inactive (keep-alive)", async () => {
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/a.ts", worktreePath: "/wt", preview: false });
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/b.ts", worktreePath: "/wt", preview: false });
    renderWithProviders(<EditorGroup />);
    const a = await screen.findByTestId("file-tab-content-file:/wt/a.ts");
    const b = await screen.findByTestId("file-tab-content-file:/wt/b.ts");
    expect(a).toHaveAttribute("aria-hidden", "true");
    expect(b).toHaveAttribute("aria-hidden", "false");
  });

  it("suspends clean file tabs beyond the LRU limit (oldest unmounted)", () => {
    useSettingsStore.setState({
      values: { "advanced.lruLimit": 2 },
      status: "idle",
      lastError: null,
    });
    // Open 4 clean tabs; most-recent (f4) is active.
    const paths = ["/wt/f1.ts", "/wt/f2.ts", "/wt/f3.ts", "/wt/f4.ts"];
    for (const p of paths) {
      useWorkbench.getState().openFileTab({ kind: "file", path: p, worktreePath: "/wt", preview: false });
    }
    // accessOrder is now MRU first: f4, f3, f2, f1 — limit 2 means f1 and f2 are suspended.
    renderWithProviders(<EditorGroup />);
    expect(screen.queryByTestId("file-tab-content-file:/wt/f1.ts")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-tab-content-file:/wt/f2.ts")).not.toBeInTheDocument();
    expect(screen.getByTestId("file-tab-content-file:/wt/f3.ts")).toBeInTheDocument();
    expect(screen.getByTestId("file-tab-content-file:/wt/f4.ts")).toBeInTheDocument();
  });

  it("keeps a dirty file tab mounted even when it falls outside the LRU window", () => {
    useSettingsStore.setState({
      values: { "advanced.lruLimit": 2 },
      status: "idle",
      lastError: null,
    });
    // Open 3 clean tabs (f1 oldest, f3 newest/active).
    const paths = ["/wt/dirty1.ts", "/wt/dirty2.ts", "/wt/dirty3.ts"];
    for (const p of paths) {
      useWorkbench.getState().openFileTab({ kind: "file", path: p, worktreePath: "/wt", preview: false });
    }
    // Mark the oldest tab dirty.
    useWorkbench.getState().setFileTabDirty("file:/wt/dirty1.ts", true);
    // accessOrder MRU: f3, f2, f1. Limit 2 → window {f3, f2}. But f1 is dirty → force-kept.
    renderWithProviders(<EditorGroup />);
    expect(screen.getByTestId("file-tab-content-file:/wt/dirty1.ts")).toBeInTheDocument();
    expect(screen.getByTestId("file-tab-content-file:/wt/dirty2.ts")).toBeInTheDocument();
    expect(screen.getByTestId("file-tab-content-file:/wt/dirty3.ts")).toBeInTheDocument();
  });
});
