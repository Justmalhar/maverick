import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { QuickOpen } from "./QuickOpen";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";
import type { FileEntry } from "@/lib/ipc";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({
    ...initial, workspaces: [], activeWorkspaceId: null, quickOpenOpen: false,
  });
});

describe("QuickOpen", () => {
  it("does nothing when closed", () => {
    renderWithProviders(<QuickOpen />);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("flattens file tree and shows the list when open", async () => {
    const tree: FileEntry[] = [
      { path: "/", name: "/", isDirectory: true, children: [
        { path: "/a.ts", name: "a.ts", isDirectory: false },
        { path: "/sub", name: "sub", isDirectory: true, children: [
          { path: "/sub/b.ts", name: "b.ts", isDirectory: false },
        ] },
      ] },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(tree as never);
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
      quickOpenOpen: true,
    });
    renderWithProviders(<QuickOpen />);
    await waitFor(() => expect(screen.getByTestId("quickopen-item-/a.ts")).toBeInTheDocument());
  });

  it("swallows file-tree errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("nope"));
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
      quickOpenOpen: true,
    });
    renderWithProviders(<QuickOpen />);
    await waitFor(() => expect(screen.getByText("No files found")).toBeInTheDocument());
  });

  it("selecting a file closes the dialog (covers onSelect callback)", async () => {
    const tree: FileEntry[] = [{ path: "/a.ts", name: "a.ts", isDirectory: false }];
    vi.mocked(invoke).mockResolvedValueOnce(tree as never);
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
      quickOpenOpen: true,
    });
    renderWithProviders(<QuickOpen />);
    const item = await screen.findByTestId("quickopen-item-/a.ts");
    item.click();
    await waitFor(() => expect(useWorkbench.getState().quickOpenOpen).toBe(false));
  });
});
