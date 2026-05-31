import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor, fireEvent } from "@/test/utils";
import { QuickOpen, basename, joinPath } from "./QuickOpen";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";
import type { SearchResult } from "@/lib/ipc";

const initial = useWorkbench.getState();

function mockSearch(result: SearchResult | Error) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "file_search") {
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result as never);
    }
    return Promise.resolve(undefined as never);
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({
    ...initial,
    workspaces: [],
    activeWorkspaceId: null,
    quickOpenOpen: false,
    previewFile: null,
  });
});

describe("basename", () => {
  it("returns the last path segment", () => {
    expect(basename("a/b/c.ts")).toBe("c.ts");
    expect(basename("top.ts")).toBe("top.ts");
  });
});

describe("joinPath", () => {
  it("joins a normal root and rel with a single separator", () => {
    expect(joinPath("/Users/me/wt", "src/a.ts")).toBe("/Users/me/wt/src/a.ts");
  });

  it("does not double-slash when root ends with a separator", () => {
    expect(joinPath("/Users/me/wt/", "src/a.ts")).toBe("/Users/me/wt/src/a.ts");
  });

  it("handles the filesystem root without doubling", () => {
    expect(joinPath("/", "a.ts")).toBe("/a.ts");
  });
});

describe("QuickOpen", () => {
  it("does nothing when closed", () => {
    renderWithProviders(<QuickOpen />);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("searches files by name and lists hits", async () => {
    mockSearch({
      hits: [
        { rel: "src/a.ts", name: "a.ts", isDirectory: false },
        { rel: "src/sub/b.ts", name: "b.ts", isDirectory: false },
      ],
      truncated: false,
    });
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
      quickOpenOpen: true,
    });
    renderWithProviders(<QuickOpen />);
    fireEvent.change(screen.getByTestId("quickopen-input"), { target: { value: "a" } });
    await waitFor(() =>
      expect(screen.getByTestId("quickopen-item-src/a.ts")).toBeInTheDocument()
    );
  });

  it("shows the truncated hint when the search budget is hit", async () => {
    mockSearch({
      hits: [{ rel: "a.ts", name: "a.ts", isDirectory: false }],
      truncated: true,
    });
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
      quickOpenOpen: true,
    });
    renderWithProviders(<QuickOpen />);
    fireEvent.change(screen.getByTestId("quickopen-input"), { target: { value: "a" } });
    await waitFor(() =>
      expect(screen.getByTestId("quickopen-truncated")).toBeInTheDocument()
    );
  });

  it("blank query does not search", async () => {
    mockSearch({ hits: [], truncated: false });
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
      quickOpenOpen: true,
    });
    renderWithProviders(<QuickOpen />);
    fireEvent.change(screen.getByTestId("quickopen-input"), { target: { value: "   " } });
    await waitFor(() => expect(screen.getByText("No files found")).toBeInTheDocument());
    expect(invoke).not.toHaveBeenCalled();
  });

  it("swallows search errors and clears prior hits", async () => {
    // First query succeeds and renders a hit; a follow-up query rejects and the
    // catch branch must clear the list back to empty.
    let mode: "ok" | "fail" = "ok";
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "file_search") {
        return mode === "ok"
          ? Promise.resolve({
              hits: [{ rel: "a.ts", name: "a.ts", isDirectory: false }],
              truncated: false,
            } as never)
          : Promise.reject(new Error("nope"));
      }
      return Promise.resolve(undefined as never);
    });
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
      quickOpenOpen: true,
    });
    renderWithProviders(<QuickOpen />);
    fireEvent.change(screen.getByTestId("quickopen-input"), { target: { value: "a" } });
    await waitFor(() => expect(screen.getByTestId("quickopen-item-a.ts")).toBeInTheDocument());
    mode = "fail";
    fireEvent.change(screen.getByTestId("quickopen-input"), { target: { value: "ab" } });
    await waitFor(() =>
      expect(screen.queryByTestId("quickopen-item-a.ts")).not.toBeInTheDocument()
    );
    expect(screen.getByText("No files found")).toBeInTheDocument();
  });

  it("selecting a hit opens the preview and closes the dialog", async () => {
    mockSearch({
      hits: [{ rel: "src/a.ts", name: "a.ts", isDirectory: false }],
      truncated: false,
    });
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
      quickOpenOpen: true,
    });
    renderWithProviders(<QuickOpen />);
    fireEvent.change(screen.getByTestId("quickopen-input"), { target: { value: "a" } });
    const item = await screen.findByTestId("quickopen-item-src/a.ts");
    item.click();
    await waitFor(() => expect(useWorkbench.getState().quickOpenOpen).toBe(false));
    expect(useWorkbench.getState().previewFile).toEqual({
      path: "/wt/src/a.ts",
      name: "a.ts",
    });
  });

  it("clears state when reopened", async () => {
    mockSearch({ hits: [], truncated: false });
    const { rerender } = renderWithProviders(<QuickOpen />);
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
      quickOpenOpen: true,
    });
    rerender(<QuickOpen />);
    await waitFor(() => expect(screen.getByText("No files found")).toBeInTheDocument());
  });
});
