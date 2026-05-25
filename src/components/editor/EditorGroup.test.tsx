import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { EditorGroup } from "./EditorGroup";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
  useWorkbench.setState({
    ...initial, workspaces: [], activeWorkspaceId: null, editorModes: {}, splitTrees: {},
    systemTabs: [], activeSystemTab: null,
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
});
