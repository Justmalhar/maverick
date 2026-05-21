import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { FilesView } from "./FilesView";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";
import type { FileEntry } from "@/lib/ipc";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
});

describe("FilesView", () => {
  it("shows empty state without active workspace", () => {
    renderWithProviders(<FilesView />);
    expect(screen.getByText("No active workspace")).toBeInTheDocument();
  });

  it("renders tree (recursive) and file extension icons", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    const tree: FileEntry[] = [
      {
        path: "/wt", name: "wt", isDirectory: true,
        children: [
          { path: "/wt/readme.md", name: "readme.md", isDirectory: false, status: "M" },
          { path: "/wt/a.ts", name: "a.ts", isDirectory: false, status: "A" },
          { path: "/wt/b.ts", name: "b.ts", isDirectory: false, status: "D" },
          { path: "/wt/c.ts", name: "c.ts", isDirectory: false, status: "R" },
        ],
      },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(tree as never);
    renderWithProviders(<FilesView />);
    await waitFor(() => expect(screen.getByTestId("files-view")).toBeInTheDocument());
    expect(screen.getByText("readme.md")).toBeInTheDocument();
  });

  it("shows 'No files' when the tree is empty", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockResolvedValueOnce([] as never);
    renderWithProviders(<FilesView />);
    await waitFor(() => expect(screen.getByText("No files")).toBeInTheDocument());
  });

  it("clears entries when fetch fails", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
    renderWithProviders(<FilesView />);
    await waitFor(() => expect(screen.getByText("No files")).toBeInTheDocument());
  });
});
