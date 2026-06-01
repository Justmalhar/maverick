import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { EditorTabs } from "./EditorTabs";
import { useWorkbench } from "@/state/store";
import { defaultTerminalCwd } from "@/lib/default-cwd";
import { __resetTerminalShellCacheForTests } from "@/hooks/useTerminalTab";
import { makeWorkspace, makePreset } from "@/test/fixtures";

vi.mock("@/lib/tauri", async (orig) => {
  const actual = await orig<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    ptySpawn: vi.fn(async () => ({ ptyId: "pty-1" })),
    ptyKill: vi.fn(async () => undefined),
    defaultShell: vi.fn(async () => "/bin/zsh"),
  };
});

vi.mock("@/lib/default-cwd", () => ({
  defaultTerminalCwd: vi.fn(async () => "/Users/test/Desktop"),
}));

const initial = useWorkbench.getState();

beforeEach(() => {
  __resetTerminalShellCacheForTests();
  useWorkbench.setState({
    ...initial,
    workspaces: [],
    activeWorkspaceId: null,
    commandPaletteOpen: false,
    editorModes: {},
    systemTabs: [],
    activeSystemTab: null,
    terminalTabs: [],
    activeTerminalTabId: null,
  });
});

describe("EditorTabs", () => {
  it("renders workspace tabs and reacts to clicks", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" })],
      activeWorkspaceId: "w1",
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [],
      activeTerminalTabId: null,
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

  it("plus dropdown contains New Terminal and tab items but not Browser", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    expect(screen.getByTestId("editor-tabs-open-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("editor-tabs-open-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("editor-tabs-open-kanban")).toBeInTheDocument();
    expect(screen.getByTestId("editor-tabs-open-automations")).toBeInTheDocument();
    expect(screen.getByTestId("editor-tabs-open-mcps")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-tabs-open-browser")).not.toBeInTheDocument();
  });

  it("clicking the Terminal item spawns a PTY and adds a terminal tab", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    await userEvent.click(screen.getByTestId("editor-tabs-open-terminal-tab"));

    await waitFor(() => expect(useWorkbench.getState().terminalTabs).toHaveLength(1));
    const state = useWorkbench.getState();
    expect(state.terminalTabs[0].cwd).toBe("/Users/test/Desktop");
    expect(state.terminalTabs[0].ptyId).toBe("pty-1");
    expect(state.activeTerminalTabId).toBe(state.terminalTabs[0].id);
  });

  it("renders terminal tabs in the strip and switches on click", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [],
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [
        { id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" },
        { id: "t2", cwd: "/b", title: "b", ptyId: "pty-2" },
      ],
      activeTerminalTabId: "t1",
    });
    renderWithProviders(<EditorTabs />);
    expect(screen.getByTestId("editor-tab-terminal-t1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("editor-tab-terminal-t2"));
    expect(useWorkbench.getState().activeTerminalTabId).toBe("t2");
  });

  it("close button on a terminal tab removes it and kills its PTY", async () => {
    const { ptyKill } = await import("@/lib/tauri");
    useWorkbench.setState({
      ...initial,
      workspaces: [],
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [{ id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" }],
      activeTerminalTabId: "t1",
    });
    renderWithProviders(<EditorTabs />);
    const closeBtn = screen.getByLabelText("Close a");
    await userEvent.click(closeBtn);
    await new Promise((r) => setTimeout(r, 0));
    expect(ptyKill).toHaveBeenCalledWith("pty-1");
    expect(useWorkbench.getState().terminalTabs).toHaveLength(0);
  });

  it("keyboard Enter on a terminal tab close button removes it", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [],
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [{ id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" }],
      activeTerminalTabId: "t1",
    });
    renderWithProviders(<EditorTabs />);
    fireEvent.keyDown(screen.getByLabelText("Close a"), { key: "Enter" });
    await waitFor(() => expect(useWorkbench.getState().terminalTabs).toHaveLength(0));
  });

  it("logs an error when opening a terminal tab fails", async () => {
    vi.mocked(defaultTerminalCwd).mockRejectedValueOnce(new Error("no cwd"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    await userEvent.click(screen.getByTestId("editor-tabs-open-terminal-tab"));
    await waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith("Failed to open terminal tab", expect.any(Error))
    );
    expect(useWorkbench.getState().terminalTabs).toHaveLength(0);
    errSpy.mockRestore();
  });

  it("clicking a workspace tab while a system tab is active switches to the workspace", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      systemTabs: ["kanban"],
      activeSystemTab: "kanban",
      activeWorkspaceId: null,
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

  it("closing the save-layout dialog clears the target", async () => {
    vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<EditorTabs />);
    fireEvent.contextMenu(screen.getByTestId("editor-tab-w1"));
    expect(await screen.findByTestId("save-layout-dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("save-layout-cancel"));
    await waitFor(() => expect(screen.queryByTestId("save-layout-dialog")).toBeNull());
  });
});
