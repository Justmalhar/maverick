import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { EditorGroup } from "./EditorGroup";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

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
});
