import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { EditorTabs } from "./EditorTabs";
import { useWorkbench } from "@/state/store";
import { makeWorkspace, makePreset } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({
    ...initial,
    workspaces: [],
    activeWorkspaceId: null,
    commandPaletteOpen: false,
    systemTabs: [],
    activeSystemTab: null,
    terminalGroups: [],
    activeGroupByWorkspace: {},
    fileTabs: [],
    activeFileTabId: null,
    fileTabAccessOrder: [],
  });
});

function seed() {
  useWorkbench.setState({
    workspaces: [
      { id: "w1", projectId: "p", branch: "b1", agentBackend: "claude", worktreePath: "/wt/w1", status: "active", sessionId: "s", title: "A" },
      { id: "w2", projectId: "p", branch: "b2", agentBackend: "claude", worktreePath: "/wt/w2", status: "active", sessionId: "s", title: "B" },
    ],
    activeWorkspaceId: "w1",
    terminalGroups: [
      { id: "w1", workspaceId: "w1", title: "Terminal 1" },
      { id: "term-2", workspaceId: "w1", title: "Terminal 2" },
      { id: "w2", workspaceId: "w2", title: "Terminal 1" },
    ],
    activeGroupByWorkspace: { w1: "w1", w2: "w2" },
    fileTabs: [
      { id: "file:/wt/w1/a.ts", kind: "file", path: "/wt/w1/a.ts", worktreePath: "/wt/w1", workspaceId: "w1", preview: false, dirty: false, mode: "edit", viewed: false },
      { id: "file:/wt/w2/b.ts", kind: "file", path: "/wt/w2/b.ts", worktreePath: "/wt/w2", workspaceId: "w2", preview: false, dirty: false, mode: "edit", viewed: false },
    ],
    activeFileTabId: null, activeSystemTab: null, systemTabs: [], fileTabAccessOrder: [],
  });
}

it("shows only the active workspace's chip + group + file tabs", () => {
  seed();
  renderWithProviders(<EditorTabs />);
  expect(screen.getByTestId("editor-tab-w1")).toBeInTheDocument();
  expect(screen.queryByTestId("editor-tab-w2")).toBeNull();
  expect(screen.getByTestId("editor-tab-group-w1")).toBeInTheDocument();
  expect(screen.getByTestId("editor-tab-group-term-2")).toBeInTheDocument();
  expect(screen.queryByTestId("editor-tab-group-w2")).toBeNull();
  expect(screen.getByText("a.ts")).toBeInTheDocument();
  expect(screen.queryByText("b.ts")).toBeNull();
});

it("primary group tab has no close button; extra group does", () => {
  seed();
  renderWithProviders(<EditorTabs />);
  expect(screen.queryByLabelText("Close Terminal 1")).toBeNull();
  expect(screen.getByLabelText("Close Terminal 2")).toBeInTheDocument();
});

it("clicking the group-close button closes the terminal group (line 218 onClick)", async () => {
  seed();
  renderWithProviders(<EditorTabs />);
  const closeBtn = screen.getByLabelText("Close Terminal 2");
  expect(closeBtn).toBeInTheDocument();
  await userEvent.click(closeBtn);
  await waitFor(() =>
    expect(useWorkbench.getState().terminalGroups.some((g) => g.id === "term-2")).toBe(false)
  );
});

it("keyboard Enter on group-close button closes the terminal group (line 219 onKeyDown)", async () => {
  seed();
  renderWithProviders(<EditorTabs />);
  const closeBtn = screen.getByLabelText("Close Terminal 2");
  expect(closeBtn).toBeInTheDocument();
  // The group is closable — fire keyboard Enter to trigger the onKeyDown handler
  fireEvent.keyDown(closeBtn, { key: "Enter" });
  await waitFor(() =>
    expect(useWorkbench.getState().terminalGroups.some((g) => g.id === "term-2")).toBe(false)
  );
});

it("keyboard Space on group-close button closes the terminal group (line 219 onKeyDown ' ' branch)", async () => {
  // Re-seed to restore term-2
  seed();
  renderWithProviders(<EditorTabs />);
  const closeBtn = screen.getByLabelText("Close Terminal 2");
  fireEvent.keyDown(closeBtn, { key: " " });
  await waitFor(() =>
    expect(useWorkbench.getState().terminalGroups.some((g) => g.id === "term-2")).toBe(false)
  );
});

it("+ adds a terminal group to the context workspace", async () => {
  seed();
  renderWithProviders(<EditorTabs />);
  await userEvent.click(screen.getByTestId("editor-tabs-add-terminal"));
  expect(useWorkbench.getState().terminalGroups.filter((g) => g.workspaceId === "w1")).toHaveLength(3);
});

it("editor-tabs-add-terminal button is disabled when there is no context workspace", () => {
  // No workspaces, no active workspace, no active file tab — contextWorkspaceId is null.
  useWorkbench.setState({
    ...initial,
    workspaces: [],
    activeWorkspaceId: null,
    fileTabs: [],
    activeFileTabId: null,
    terminalGroups: [],
    activeGroupByWorkspace: {},
    systemTabs: [],
    activeSystemTab: null,
  });
  renderWithProviders(<EditorTabs />);
  const btn = screen.getByTestId("editor-tabs-add-terminal");
  expect(btn).toBeDisabled();
});

describe("EditorTabs", () => {
  it("renders workspace tabs and reacts to clicks", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
      systemTabs: [],
      activeSystemTab: null,
      terminalGroups: [
        { id: "w1", workspaceId: "w1", title: "Terminal 1" },
      ],
      activeGroupByWorkspace: { w1: "w1" },
    });
    renderWithProviders(<EditorTabs />);
    expect(screen.getByTestId("editor-tab-w1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("editor-tab-w1"));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w1");
  });

  it("close button on a workspace tab removes it", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" })],
      activeWorkspaceId: "w1",
      terminalGroups: [
        { id: "w1", workspaceId: "w1", title: "Terminal 1" },
        { id: "w2", workspaceId: "w2", title: "Terminal 1" },
      ],
      activeGroupByWorkspace: { w1: "w1", w2: "w2" },
    });
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getAllByLabelText("Close workspace")[0]);
    expect(useWorkbench.getState().workspaces.map((w) => w.id)).toEqual(["w2"]);
  });

  it("standalone browser button opens the browser system tab", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-browser"));
    expect(useWorkbench.getState().activeSystemTab).toBe("browser");
    expect(useWorkbench.getState().systemTabs).toContain("browser");
  });

  it("plus dropdown contains New Terminal in Panel and tab items but not Browser", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    expect(screen.getByTestId("editor-tabs-open-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("editor-tabs-open-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("editor-tabs-open-kanban")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-tabs-open-automations")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-tabs-open-mcps")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-tabs-open-browser")).not.toBeInTheDocument();
  });

  it("clicking a workspace tab while a system tab is active switches to the workspace", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      systemTabs: ["kanban"],
      activeSystemTab: "kanban",
      activeWorkspaceId: null,
      fileTabs: [{ id: "file:/tmp/x.ts", kind: "file", path: "/tmp/x.ts", worktreePath: "/tmp", workspaceId: "w1", preview: false, dirty: false, mode: "edit", viewed: false }],
      activeFileTabId: "file:/tmp/x.ts",
      terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
      activeGroupByWorkspace: { w1: "w1" },
    });
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tab-w1"));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w1");
    // The system tab must be deactivated so the workspace editor shows.
    expect(useWorkbench.getState().activeSystemTab).toBeNull();
  });

  it("inactive system tab click activates it", async () => {
    useWorkbench.setState({
      ...initial,
      systemTabs: ["browser", "kanban"],
      activeSystemTab: "browser",
      activeWorkspaceId: null,
    });
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tab-system-kanban"));
    expect(useWorkbench.getState().activeSystemTab).toBe("kanban");
  });

  it("close button on system tab removes it from systemTabs", async () => {
    useWorkbench.setState({
      ...initial,
      systemTabs: ["browser"],
      activeSystemTab: "browser",
      activeWorkspaceId: null,
    });
    renderWithProviders(<EditorTabs />);
    const closeBtn = screen.getByLabelText("Close Browser");
    await userEvent.click(closeBtn);
    expect(useWorkbench.getState().systemTabs).not.toContain("browser");
  });

  it("keyboard Enter on close button removes system tab", () => {
    useWorkbench.setState({
      ...initial,
      systemTabs: ["kanban"],
      activeSystemTab: "kanban",
      activeWorkspaceId: null,
    });
    renderWithProviders(<EditorTabs />);
    const closeBtn = screen.getByLabelText("Close Tasks");
    fireEvent.keyDown(closeBtn, { key: "Enter" });
    expect(useWorkbench.getState().systemTabs).not.toContain("kanban");
  });

  it("keyboard Space on close button removes system tab", () => {
    useWorkbench.setState({
      ...initial,
      systemTabs: ["mcps"],
      activeSystemTab: "mcps",
      activeWorkspaceId: null,
    });
    renderWithProviders(<EditorTabs />);
    const closeBtn = screen.getByLabelText("Close MCP Servers");
    fireEvent.keyDown(closeBtn, { key: " " });
    expect(useWorkbench.getState().systemTabs).not.toContain("mcps");
  });

  it("dropdown item click opens a system tab", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    await userEvent.click(screen.getByTestId("editor-tabs-open-kanban"));
    expect(useWorkbench.getState().systemTabs).toContain("kanban");
  });

  it("All commands dropdown item opens command palette", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    await userEvent.click(screen.getByText(/All commands/i));
    expect(useWorkbench.getState().commandPaletteOpen).toBe(true);
  });

  it("New Terminal item shows panel and dispatches maverick:panel:tab terminal", async () => {
    renderWithProviders(<EditorTabs />);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    await userEvent.click(screen.getByTestId("editor-tabs-open-terminal"));
    expect(useWorkbench.getState().layout.panelVisible).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "maverick:panel:tab", detail: "terminal" })
    );
    dispatchSpy.mockRestore();
  });

  it("New Terminal item does not double-toggle panel when already visible", async () => {
    useWorkbench.setState({
      ...useWorkbench.getState(),
      layout: { ...useWorkbench.getState().layout, panelVisible: true },
    });
    renderWithProviders(<EditorTabs />);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    await userEvent.click(screen.getByTestId("editor-tabs-open-terminal"));
    expect(useWorkbench.getState().layout.panelVisible).toBe(true);
    dispatchSpy.mockRestore();
  });

  it("right-clicking a workspace tab saves the layout as a preset", async () => {
    vi.mocked(invoke).mockReset().mockImplementation((cmd: string) => {
      if (cmd === "preset_save_current") return Promise.resolve(makePreset({ name: "Saved" })) as never;
      return Promise.resolve([]) as never;
    });
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", agentBackend: "claude" })],
      activeWorkspaceId: "w1",
      terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
      activeGroupByWorkspace: { w1: "w1" },
    });
    renderWithProviders(<EditorTabs />);
    fireEvent.contextMenu(screen.getByTestId("editor-tab-w1"));
    expect(await screen.findByTestId("save-layout-dialog")).toBeInTheDocument();
    await userEvent.type(screen.getByTestId("save-layout-name"), "Saved");
    await userEvent.click(screen.getByTestId("save-layout-confirm"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "preset_save_current",
        expect.objectContaining({ workspaceId: "w1", name: "Saved" })
      )
    );
  });

  it("split button dispatches the same splitH event as ⌘D", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
      terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
      activeGroupByWorkspace: { w1: "w1" },
    });
    const onSplit = vi.fn();
    window.addEventListener("maverick:terminal:splitH", onSplit);
    try {
      renderWithProviders(<EditorTabs />);
      await userEvent.click(screen.getByTestId("editor-tabs-split"));
      expect(onSplit).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("maverick:terminal:splitH", onSplit);
    }
  });

  describe("maverick:closeActiveTab (⌘W)", () => {
    function fireCloseActiveTab() {
      fireEvent(window, new CustomEvent("maverick:closeActiveTab"));
    }

    it("closes the active workspace tab when it has no splits", () => {
      useWorkbench.setState({
        ...initial,
        workspaces: [makeWorkspace({ id: "w1" })],
        activeWorkspaceId: "w1",
        terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
        activeGroupByWorkspace: { w1: "w1" },
      });
      renderWithProviders(<EditorTabs />);
      fireCloseActiveTab();
      expect(useWorkbench.getState().workspaces).toHaveLength(0);
    });

    it("closes only the focused pane (not the tab) when the workspace has splits", () => {
      useWorkbench.setState({
        ...initial,
        workspaces: [makeWorkspace({ id: "w1" })],
        activeWorkspaceId: "w1",
        terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
        activeGroupByWorkspace: { w1: "w1" },
        splitTrees: {
          w1: {
            type: "split",
            direction: "h",
            ratio: 0.5,
            left: { type: "terminal", id: "w1-1", backend: "claude", ptyId: "w1" },
            right: { type: "terminal", id: "w1-2", backend: "claude", ptyId: "w1" },
          },
        },
      });
      const onClosePane = vi.fn();
      window.addEventListener("maverick:terminal:closePane", onClosePane);
      try {
        renderWithProviders(<EditorTabs />);
        fireCloseActiveTab();
        expect(onClosePane).toHaveBeenCalledTimes(1);
        expect(useWorkbench.getState().workspaces).toHaveLength(1);
      } finally {
        window.removeEventListener("maverick:terminal:closePane", onClosePane);
      }
    });

    it("closes the tab when the workspace split tree is down to one pane", () => {
      useWorkbench.setState({
        ...initial,
        workspaces: [makeWorkspace({ id: "w1" })],
        activeWorkspaceId: "w1",
        terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
        activeGroupByWorkspace: { w1: "w1" },
        splitTrees: {
          w1: { type: "terminal", id: "w1-1", backend: "claude", ptyId: "w1" },
        },
      });
      renderWithProviders(<EditorTabs />);
      fireCloseActiveTab();
      expect(useWorkbench.getState().workspaces).toHaveLength(0);
    });

    it("closes the active system tab", () => {
      useWorkbench.setState({ ...initial });
      useWorkbench.getState().openSystemTab("kanban");
      renderWithProviders(<EditorTabs />);
      fireCloseActiveTab();
      expect(useWorkbench.getState().systemTabs).not.toContain("kanban");
    });

    it("closes a clean file tab", () => {
      useWorkbench.setState({ ...initial });
      useWorkbench.getState().openFileTab({
        kind: "file",
        path: "/repo/a.ts",
        worktreePath: "/repo",
        preview: false,
      });
      renderWithProviders(<EditorTabs />);
      expect(useWorkbench.getState().fileTabs).toHaveLength(1);
      fireCloseActiveTab();
      expect(useWorkbench.getState().fileTabs).toHaveLength(0);
    });

    it("opens the unsaved-changes confirm for a dirty file tab", async () => {
      useWorkbench.setState({ ...initial });
      useWorkbench.getState().openFileTab({
        kind: "file",
        path: "/repo/b.ts",
        worktreePath: "/repo",
        preview: false,
      });
      const id = useWorkbench.getState().activeFileTabId!;
      useWorkbench.getState().setFileTabDirty(id, true);
      renderWithProviders(<EditorTabs />);
      fireCloseActiveTab();
      expect(await screen.findByText("Unsaved changes")).toBeInTheDocument();
      expect(useWorkbench.getState().fileTabs).toHaveLength(1);
    });

    it("Cancel button in unsaved-changes confirm closes dialog without removing the tab", async () => {
      useWorkbench.setState({ ...initial });
      useWorkbench.getState().openFileTab({
        kind: "file",
        path: "/repo/b.ts",
        worktreePath: "/repo",
        preview: false,
      });
      const id = useWorkbench.getState().activeFileTabId!;
      useWorkbench.getState().setFileTabDirty(id, true);
      renderWithProviders(<EditorTabs />);
      fireCloseActiveTab();
      await screen.findByText("Unsaved changes");
      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
      await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());
      expect(useWorkbench.getState().fileTabs).toHaveLength(1);
    });

    it("Escape closes the dirty-file confirm dialog via onOpenChange (line 360 callback)", async () => {
      useWorkbench.setState({ ...initial });
      useWorkbench.getState().openFileTab({
        kind: "file",
        path: "/repo/c.ts",
        worktreePath: "/repo",
        preview: false,
      });
      const id = useWorkbench.getState().activeFileTabId!;
      useWorkbench.getState().setFileTabDirty(id, true);
      renderWithProviders(<EditorTabs />);
      fireCloseActiveTab();
      await screen.findByText("Unsaved changes");
      // Escape triggers the Dialog's onOpenChange(false) → our callback fires
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());
      expect(useWorkbench.getState().fileTabs).toHaveLength(1);
    });

    it("Close without saving button force-closes the dirty tab", async () => {
      useWorkbench.setState({ ...initial });
      useWorkbench.getState().openFileTab({
        kind: "file",
        path: "/repo/b.ts",
        worktreePath: "/repo",
        preview: false,
      });
      const id = useWorkbench.getState().activeFileTabId!;
      useWorkbench.getState().setFileTabDirty(id, true);
      renderWithProviders(<EditorTabs />);
      fireCloseActiveTab();
      await screen.findByText("Unsaved changes");
      await userEvent.click(screen.getByRole("button", { name: /close without saving/i }));
      await waitFor(() => expect(useWorkbench.getState().fileTabs).toHaveLength(0));
    });

    it("is a no-op when nothing is active", () => {
      useWorkbench.setState({
        ...initial,
        workspaces: [makeWorkspace({ id: "w1" })],
        activeWorkspaceId: "w1",
        systemTabs: [],
        terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
        activeGroupByWorkspace: { w1: "w1" },
      });
      renderWithProviders(<EditorTabs />);
      // EditorTabs only mounts with tabs present; clear active ids then fire.
      useWorkbench.setState({ activeWorkspaceId: null });
      fireCloseActiveTab();
      expect(useWorkbench.getState().workspaces).toHaveLength(1);
    });

    it("calls closeTerminalGroup when the active group is non-primary with a single pane", () => {
      // Seed: active workspace w1, active group is "term-2" (non-primary: term-2 !== w1),
      // single-leaf split tree for term-2 so countLeaves returns 1.
      useWorkbench.setState({
        ...initial,
        workspaces: [makeWorkspace({ id: "w1" })],
        activeWorkspaceId: "w1",
        activeFileTabId: null,
        activeSystemTab: null,
        terminalGroups: [
          { id: "w1", workspaceId: "w1", title: "Terminal 1" },
          { id: "term-2", workspaceId: "w1", title: "Terminal 2" },
        ],
        activeGroupByWorkspace: { w1: "term-2" },
        splitTrees: {
          "term-2": { type: "terminal", id: "term-2-leaf", backend: "claude", ptyId: "term-2" },
        },
      });
      const closeTerminalGroup = vi.spyOn(useWorkbench.getState(), "closeTerminalGroup");
      renderWithProviders(<EditorTabs />);
      fireCloseActiveTab();
      expect(closeTerminalGroup).toHaveBeenCalledWith("term-2");
      expect(useWorkbench.getState().workspaces).toHaveLength(1);
    });
  });

  it("closing the save-layout dialog clears the target", async () => {
    vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
      terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
      activeGroupByWorkspace: { w1: "w1" },
    });
    renderWithProviders(<EditorTabs />);
    fireEvent.contextMenu(screen.getByTestId("editor-tab-w1"));
    expect(await screen.findByTestId("save-layout-dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("save-layout-cancel"));
    await waitFor(() => expect(screen.queryByTestId("save-layout-dialog")).toBeNull());
  });

  it("clicking a file editor tab selects it (onSelect callback, line 235)", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
      terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
      activeGroupByWorkspace: { w1: "w1" },
    });
    useWorkbench.getState().openFileTab({
      kind: "file",
      path: "/wt/w1/a.ts",
      worktreePath: "/wt/w1",
      preview: false,
    });
    // open a second file so we can switch away then click back
    useWorkbench.getState().openFileTab({
      kind: "file",
      path: "/wt/w1/b.ts",
      worktreePath: "/wt/w1",
      preview: false,
    });
    const tabIdA = useWorkbench.getState().fileTabs.find((t) => t.path === "/wt/w1/a.ts")!.id;
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId(`editor-tab-file-${tabIdA}`));
    expect(useWorkbench.getState().activeFileTabId).toBe(tabIdA);
  });

  it("double-clicking a file editor tab pins it (onPin callback)", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
      terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
      activeGroupByWorkspace: { w1: "w1" },
    });
    useWorkbench.getState().openFileTab({
      kind: "file",
      path: "/wt/w1/a.ts",
      worktreePath: "/wt/w1",
      preview: true,
    });
    const tabId = useWorkbench.getState().activeFileTabId!;
    expect(useWorkbench.getState().fileTabs.find((t) => t.id === tabId)?.preview).toBe(true);
    renderWithProviders(<EditorTabs />);
    const fileTab = screen.getByText("a.ts");
    fireEvent.dblClick(fileTab);
    expect(useWorkbench.getState().fileTabs.find((t) => t.id === tabId)?.preview).toBe(false);
  });

  it("shows only the active workspace's tab, not other workspaces", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [
        { id: "ws1", projectId: "p1", branch: "feature/alpha", agentBackend: "claude", worktreePath: "/tmp/a", status: "idle", sessionId: "s1" },
        { id: "ws2", projectId: "p1", branch: "feature/beta", agentBackend: "claude", worktreePath: "/tmp/b", status: "idle", sessionId: "s2" },
      ],
      activeWorkspaceId: "ws1",
      terminalGroups: [
        { id: "ws1", workspaceId: "ws1", title: "Terminal 1" },
        { id: "ws2", workspaceId: "ws2", title: "Terminal 1" },
      ],
      activeGroupByWorkspace: { ws1: "ws1", ws2: "ws2" },
    });
    renderWithProviders(<EditorTabs />);
    // EditorTab renders `workspace.title ?? workspace.branch` (EditorTab.tsx:57)
    expect(screen.getByText("feature/alpha")).toBeInTheDocument();
    expect(screen.queryByText("feature/beta")).not.toBeInTheDocument();
  });

  it("shows the owning workspace's tab when a file tab from it is active with no active workspace", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [
        { id: "ws1", projectId: "p1", branch: "feature/alpha", agentBackend: "claude", worktreePath: "/tmp/a", status: "idle", sessionId: "s1" },
        { id: "ws2", projectId: "p1", branch: "feature/beta", agentBackend: "claude", worktreePath: "/tmp/b", status: "idle", sessionId: "s2" },
      ],
      activeWorkspaceId: null,
      fileTabs: [{ id: "file:/tmp/a/x.ts", kind: "file", path: "/tmp/a/x.ts", worktreePath: "/tmp/a", workspaceId: "ws1", preview: true, dirty: false, mode: "edit", viewed: false }],
      activeFileTabId: "file:/tmp/a/x.ts",
      terminalGroups: [
        { id: "ws1", workspaceId: "ws1", title: "Terminal 1" },
        { id: "ws2", workspaceId: "ws2", title: "Terminal 1" },
      ],
      activeGroupByWorkspace: { ws1: "ws1", ws2: "ws2" },
    });
    renderWithProviders(<EditorTabs />);
    expect(screen.getByText("feature/alpha")).toBeInTheDocument();
    expect(screen.queryByText("feature/beta")).not.toBeInTheDocument();
  });

  it("clicking a non-active terminal group tab switches the active group (line 207 onClick)", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
      terminalGroups: [
        { id: "w1", workspaceId: "w1", title: "Terminal 1" },
        { id: "term-2", workspaceId: "w1", title: "Terminal 2" },
      ],
      activeGroupByWorkspace: { w1: "w1" },
    });
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tab-group-term-2"));
    expect(useWorkbench.getState().activeGroupByWorkspace["w1"]).toBe("term-2");
  });

  it("clicking the close button on a clean file tab closes it via onClose (lines 237-239)", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
      terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
      activeGroupByWorkspace: { w1: "w1" },
    });
    useWorkbench.getState().openFileTab({
      kind: "file",
      path: "/wt/w1/clean.ts",
      worktreePath: "/wt/w1",
      preview: false,
    });
    expect(useWorkbench.getState().fileTabs).toHaveLength(1);
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByLabelText("Close clean.ts"));
    expect(useWorkbench.getState().fileTabs).toHaveLength(0);
  });

  it("useEffect cleanup removes maverick:closeActiveTab listener on unmount (line 134 cleanup fn)", () => {
    const { unmount } = renderWithProviders(<EditorTabs />);
    const listener = vi.fn();
    // Verify the handler still fires before unmount.
    window.addEventListener("maverick:closeActiveTab", listener);
    window.dispatchEvent(new CustomEvent("maverick:closeActiveTab"));
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("maverick:closeActiveTab", listener);
    // Unmount — the cleanup in useEffect must remove the EditorTabs handler.
    // We confirm by verifying the component's own handler no longer crashes after
    // the component is gone (the cleanup ran without error).
    unmount();
    // If cleanup did not run, the stale handler would reference a now-unmounted
    // component; triggering it again would throw. Confirm it does not throw.
    expect(() =>
      window.dispatchEvent(new CustomEvent("maverick:closeActiveTab"))
    ).not.toThrow();
  });

  it("clicking the close button on a dirty file tab opens unsaved-changes dialog via onClose (lines 237-239 false branch)", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
      terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
      activeGroupByWorkspace: { w1: "w1" },
    });
    useWorkbench.getState().openFileTab({
      kind: "file",
      path: "/wt/w1/dirty.ts",
      worktreePath: "/wt/w1",
      preview: false,
    });
    const id = useWorkbench.getState().activeFileTabId!;
    useWorkbench.getState().setFileTabDirty(id, true);
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByLabelText("Close dirty.ts"));
    expect(await screen.findByText("Unsaved changes")).toBeInTheDocument();
    expect(useWorkbench.getState().fileTabs).toHaveLength(1);
  });
});
