import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor, fireEvent } from "@/test/utils";
import { FilesView, flattenTree } from "./FilesView";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";
import type { FileEntry } from "@/lib/ipc";

const initial = useWorkbench.getState();

// Route invoke() by command so the multi-call useFileTree lifecycle (file_tree +
// fs_watch_*) resolves deterministically regardless of call order.
function routeInvoke(tree: FileEntry[], opts: { treeError?: boolean } = {}) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "file_tree") {
      return opts.treeError
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(tree as never);
    }
    if (cmd === "file_read") {
      return Promise.resolve({ content: "x", size: 1, binary: false, unreadable: false } as never);
    }
    return Promise.resolve({ watching: 1 } as never);
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({
    ...initial,
    workspaces: [],
    activeWorkspaceId: null,
    previewFile: null,
  });
});

describe("flattenTree", () => {
  it("hides collapsed subtrees and expands open ones", () => {
    // FileEntry.path is RELATIVE (the sidecar contract); flatten/expand operate
    // entirely on these relative keys.
    const tree: FileEntry[] = [
      {
        path: "src",
        name: "src",
        isDirectory: true,
        children: [{ path: "src/a.ts", name: "a.ts", isDirectory: false }],
      },
    ];
    const collapsed = flattenTree(tree, new Set());
    expect(collapsed.map((n) => n.entry.path)).toEqual(["src"]);
    const open = flattenTree(tree, new Set(["src"]));
    expect(open.map((n) => n.entry.path)).toEqual(["src", "src/a.ts"]);
    expect(open[1].depth).toBe(1);
  });
});

describe("FilesView", () => {
  it("shows empty state without active workspace", () => {
    renderWithProviders(<FilesView />);
    expect(screen.getByText("No active workspace")).toBeInTheDocument();
  });

  it("renders the top-level tree (collapsed by default)", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    routeInvoke([
      { path: "readme.md", name: "readme.md", isDirectory: false, status: "M" },
      {
        path: "src",
        name: "src",
        isDirectory: true,
        children: [{ path: "src/a.ts", name: "a.ts", isDirectory: false }],
      },
    ]);
    renderWithProviders(<FilesView />);
    await waitFor(() => expect(screen.getByTestId("files-view")).toBeInTheDocument());
    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.queryByText("a.ts")).not.toBeInTheDocument();
  });

  it("expands a directory on click and collapses again", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    routeInvoke([
      {
        path: "src",
        name: "src",
        isDirectory: true,
        children: [{ path: "src/a.ts", name: "a.ts", isDirectory: false }],
      },
    ]);
    renderWithProviders(<FilesView />);
    await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("file-node-src"));
    await waitFor(() => expect(screen.getByText("a.ts")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("file-node-src"));
    await waitFor(() => expect(screen.queryByText("a.ts")).not.toBeInTheDocument());
  });

  it("opens a file in the preview on click", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    routeInvoke([{ path: "readme.md", name: "readme.md", isDirectory: false }]);
    renderWithProviders(<FilesView />);
    await waitFor(() => expect(screen.getByText("readme.md")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("file-node-readme.md"));
    // Stored path is ABSOLUTE (root-joined) so PreviewView -> fileRead can read it.
    expect(useWorkbench.getState().previewFile).toEqual({
      path: "/wt/readme.md",
      name: "readme.md",
    });
    expect(useWorkbench.getState().layout.auxiliaryView).toBe("preview");
  });

  it("opens a file via keyboard (Enter)", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    routeInvoke([{ path: "a.ts", name: "a.ts", isDirectory: false }]);
    renderWithProviders(<FilesView />);
    await waitFor(() => expect(screen.getByText("a.ts")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByTestId("file-node-a.ts"), { key: "Enter" });
    expect(useWorkbench.getState().previewFile?.path).toBe("/wt/a.ts");
  });

  it("toggles a directory via keyboard (Space)", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    routeInvoke([
      {
        path: "src",
        name: "src",
        isDirectory: true,
        children: [{ path: "src/a.ts", name: "a.ts", isDirectory: false }],
      },
    ]);
    renderWithProviders(<FilesView />);
    await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByTestId("file-node-src"), { key: " " });
    await waitFor(() => expect(screen.getByText("a.ts")).toBeInTheDocument());
  });

  it("shows 'Empty worktree' when the tree is empty", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    routeInvoke([]);
    renderWithProviders(<FilesView />);
    await waitFor(() => expect(screen.getByText("Empty worktree")).toBeInTheDocument());
  });

  it("clears entries when fetch fails", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    routeInvoke([], { treeError: true });
    renderWithProviders(<FilesView />);
    await waitFor(() => expect(screen.getByText("Empty worktree")).toBeInTheDocument());
  });

  it("virtualizes when the visible list exceeds the threshold", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    const many: FileEntry[] = Array.from({ length: 60 }, (_, i) => ({
      path: `f${i}.ts`,
      name: `f${i}.ts`,
      isDirectory: false,
    }));
    routeInvoke(many);
    renderWithProviders(<FilesView />);
    await waitFor(() => expect(screen.getByTestId("files-view")).toBeInTheDocument());
    expect(screen.getByText("f0.ts")).toBeInTheDocument();
  });

  it("clicking a file in the virtualized list opens preview", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    const many: FileEntry[] = Array.from({ length: 60 }, (_, i) => ({
      path: `f${i}.ts`,
      name: `f${i}.ts`,
      isDirectory: false,
    }));
    routeInvoke(many);
    renderWithProviders(<FilesView />);
    await waitFor(() => expect(screen.getByTestId("file-node-f0.ts")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("file-node-f0.ts"));
    // Relative entry path is resolved against /wt before being stored.
    expect(useWorkbench.getState().previewFile?.path).toBe("/wt/f0.ts");
  });
});
