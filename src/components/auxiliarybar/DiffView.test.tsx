import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { DiffView } from "./DiffView";
import { useWorkbench } from "@/state/store";
import { makeWorkspace, makeDiff, makeDiffFile } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
});

describe("DiffView", () => {
  it("shows empty state without an active workspace", () => {
    renderWithProviders(<DiffView />);
    expect(screen.getByText("No active workspace")).toBeInTheDocument();
  });

  it("shows 'no pending changes' when diff is empty", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockResolvedValueOnce({ files: [] } as never);
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view-empty")).toBeInTheDocument());
  });

  it("renders the file list when diff has files", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockResolvedValueOnce(makeDiff({
      files: [
        makeDiffFile({ path: "a.ts", status: "M" }),
        makeDiffFile({ path: "b.ts", status: "A" }),
        makeDiffFile({ path: "c.ts", status: "D" }),
        makeDiffFile({ path: "d.ts", status: "R" }),
      ],
    }) as never);
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("clears diff when fetch fails", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("x"));
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view-empty")).toBeInTheDocument());
  });
});
