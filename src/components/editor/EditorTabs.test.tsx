import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { EditorTabs } from "./EditorTabs";
import { useWorkbench } from "@/state/store";
import { availableShells } from "@/lib/terminal-shell";
import { wslAvailable, ptySpawn } from "@/lib/tauri";
import { makeWorkspace, makePreset } from "@/test/fixtures";

vi.mock("@/lib/tauri", async (orig) => {
  const actual = await orig<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    ptySpawn: vi.fn(async () => ({ ptyId: "pty-1" })),
    ptyKill: vi.fn(async () => undefined),
    wslAvailable: vi.fn(async () => true),
  };
});

// availableShells is exercised in terminal-shell.test.ts; here we drive the "+"
// menu directly by stubbing which profiles a platform offers.
vi.mock("@/lib/terminal-shell", async (orig) => {
  const actual = await orig<typeof import("@/lib/terminal-shell")>();
  return { ...actual, availableShells: vi.fn(() => []) };
});

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(availableShells).mockReturnValue([]);
  vi.mocked(wslAvailable).mockResolvedValue(true);
  vi.mocked(ptySpawn).mockReset().mockResolvedValue({ ptyId: "pty-1" });
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

it("shows both workspace chips but only the active workspace's group + file tabs", () => {
  seed();
  renderWithProviders(<EditorTabs />);
  expect(screen.getByTestId("editor-tab-w1")).toBeInTheDocument();
  expect(screen.getByTestId("editor-tab-w2")).toBeInTheDocument();
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

it("+ adds a terminal group to the context workspace", async () => {
  seed();
  renderWithProviders(<EditorTabs />);
  await userEvent.click(screen.getByTestId("editor-tabs-add-terminal"));
  expect(useWorkbench.getState().terminalGroups.filter((g) => g.workspaceId === "w1")).toHaveLength(3);
});

describe("EditorTabs", () => {
  it("renders workspace tabs and reacts to clicks", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" })],
      activeWorkspaceId: "w1",
      systemTabs: [],
      activeSystemTab: null,
      terminalGroups: [
        { id: "w1", workspaceId: "w1", title: "Terminal 1" },
        { id: "w2", workspaceId: "w2", title: "Terminal 1" },
      ],
      activeGroupByWorkspace: { w1: "w1", w2: "w2" },
    });
    renderWithProviders(<EditorTabs />);
    expect(screen.getByTestId("editor-tab-w1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("editor-tab-w2"));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w2");
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
    expect(screen.getByTestId("editor-tabs-open-automations")).toBeInTheDocument();
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
      systemTabs: ["automations"],
      activeSystemTab: "automations",
      activeWorkspaceId: null,
    });
    renderWithProviders(<EditorTabs />);
    const closeBtn = screen.getByLabelText("Close Automations");
    fireEvent.keyDown(closeBtn, { key: " " });
    expect(useWorkbench.getState().systemTabs).not.toContain("automations");
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
});
