import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { EditorGroup } from "./EditorGroup";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

vi.mock("./terminal/TerminalPane", () => ({
  TerminalPane: ({ ptyId, paneId }: { ptyId: string; paneId: string }) => (
    <div data-testid={`mock-terminal-pane-${paneId}`} data-pty={ptyId} />
  ),
}));

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null, editorModes: {}, splitTrees: {} });
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
