import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { WorkspaceEditor } from "./WorkspaceEditor";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
  useWorkbench.setState({ ...initial, editorModes: {}, splitTrees: {} });
});

describe("WorkspaceEditor", () => {
  it("renders both agent and terminal panes with visibility flags", () => {
    renderWithProviders(<WorkspaceEditor workspace={makeWorkspace({ id: "w1" })} active />);
    expect(screen.getByTestId("workspace-editor-w1")).toBeInTheDocument();
    expect(screen.getByTestId(`agent-view-w1`)).toBeInTheDocument();
  });

  it("inactive workspace adds the keep-alive-hidden class", () => {
    renderWithProviders(<WorkspaceEditor workspace={makeWorkspace({ id: "w1" })} active={false} />);
    expect(screen.getByTestId("workspace-editor-w1").className).toMatch(/keep-alive-hidden/);
  });
});
