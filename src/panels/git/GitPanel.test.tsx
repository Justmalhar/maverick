import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import GitPanel from "./GitPanel";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockImplementation((async (cmd: string) => {
    if (cmd === "diff_get") return { files: [] };
    return [];
  }) as unknown as typeof invoke);
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
});

describe("GitPanel", () => {
  it("renders empty state without a workspace", () => {
    renderWithProviders(<GitPanel />);
    expect(screen.getByTestId("git-panel-empty")).toBeInTheDocument();
  });

  it("renders tabs and switches between them", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<GitPanel />);
    expect(screen.getByTestId("git-panel")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("git-tab-staging"));
    await userEvent.click(screen.getByTestId("git-tab-stash"));
    await userEvent.click(screen.getByTestId("git-tab-branches"));
    await userEvent.click(screen.getByTestId("git-tab-blame"));
    await userEvent.click(screen.getByTestId("git-tab-conflicts"));
  });

  it("auto-flips to conflicts when workspace status is error", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt", status: "error" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<GitPanel />);
    await waitFor(() => expect(screen.getByTestId("conflict-resolver")).toBeInTheDocument());
  });

  it("opens the cherry-pick dialog", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<GitPanel />);
    await userEvent.click(screen.getByTestId("git-cherrypick-open"));
    expect(screen.getByTestId("cherrypick-dialog")).toBeInTheDocument();
  });
});
