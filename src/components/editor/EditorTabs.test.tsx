import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { EditorTabs } from "./EditorTabs";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

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

  it("clicking New Terminal spawns a PTY and adds a terminal tab", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    await userEvent.click(screen.getByTestId("editor-tabs-open-terminal"));

    await new Promise((r) => setTimeout(r, 0));

    const state = useWorkbench.getState();
    expect(state.terminalTabs).toHaveLength(1);
    expect(state.terminalTabs[0].cwd).toBe("/Users/test/Desktop");
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
});
