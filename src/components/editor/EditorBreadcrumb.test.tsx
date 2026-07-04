import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { __resetAutoFetchForTests } from "@/hooks/useSourceControl";
import { makeProject, makeWorkspace } from "@/test/fixtures";
import { EditorBreadcrumb } from "./EditorBreadcrumb";

const initial = useWorkbench.getState();

interface BranchOpts {
  upstream?: string;
  ahead?: number;
  behind?: number;
}

function mockBranch(opts: BranchOpts | null) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "git_branch_list":
        return (opts
          ? [{ name: "viper", isRemote: false, isCurrent: true, ...opts }]
          : []) as never;
      case "git_push":
      case "git_pull":
      case "git_fetch":
        return { ok: true } as never;
      default:
        return undefined as never;
    }
  });
}

function mountActive() {
  useWorkbench.setState({
    projects: [makeProject({ id: "p", name: "Alpha" })],
    workspaces: [makeWorkspace({ id: "ws", projectId: "p", branch: "viper", agentBackend: "codex" })],
    activeWorkspaceId: "ws",
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  __resetAutoFetchForTests();
  useWorkbench.setState({ ...initial, projects: [], workspaces: [], activeWorkspaceId: null });
});

describe("EditorBreadcrumb", () => {
  it("renders nothing when no workspace is active", () => {
    mockBranch(null);
    renderWithProviders(<EditorBreadcrumb />);
    expect(screen.queryByTestId("editor-breadcrumb")).not.toBeInTheDocument();
  });

  it("renders project, branch, and backend for the active workspace", () => {
    mockBranch(null);
    useWorkbench.setState({
      projects: [makeProject({ id: "p", name: "Alpha" })],
      workspaces: [makeWorkspace({ id: "ws", projectId: "p", branch: "feature/x", agentBackend: "codex" })],
      activeWorkspaceId: "ws",
    });
    renderWithProviders(<EditorBreadcrumb />);
    expect(screen.getByTestId("editor-breadcrumb")).toHaveTextContent("Alpha");
    expect(screen.getByTestId("editor-breadcrumb-branch")).toHaveTextContent("feature/x");
    expect(screen.getByTestId("editor-breadcrumb-backend")).toHaveTextContent("codex");
  });

  it("hides the sync control when the branch has no upstream", async () => {
    mockBranch({ ahead: 0, behind: 0 });
    mountActive();
    renderWithProviders(<EditorBreadcrumb />);
    await waitFor(() => expect(screen.getByTestId("editor-breadcrumb-branch")).toHaveTextContent("viper"));
    expect(screen.queryByTestId("editor-breadcrumb-sync")).not.toBeInTheDocument();
  });

  it("pushes when ahead of upstream", async () => {
    mockBranch({ upstream: "origin/viper", ahead: 2, behind: 0 });
    mountActive();
    renderWithProviders(<EditorBreadcrumb />);
    const sync = await screen.findByTestId("editor-breadcrumb-sync");
    expect(sync).toHaveTextContent("↑2");
    await userEvent.click(sync);
    await waitFor(() =>
      expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "git_push")).toBe(true)
    );
  });

  it("pulls when behind upstream", async () => {
    mockBranch({ upstream: "origin/viper", ahead: 0, behind: 3 });
    mountActive();
    renderWithProviders(<EditorBreadcrumb />);
    const sync = await screen.findByTestId("editor-breadcrumb-sync");
    expect(sync).toHaveTextContent("↓3");
    await userEvent.click(sync);
    await waitFor(() =>
      expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "git_pull")).toBe(true)
    );
  });

  it("fetches when level with upstream", async () => {
    mockBranch({ upstream: "origin/viper", ahead: 0, behind: 0 });
    mountActive();
    renderWithProviders(<EditorBreadcrumb />);
    const sync = await screen.findByTestId("editor-breadcrumb-sync");
    expect(sync).toHaveTextContent("Sync");
    await userEvent.click(sync);
    await waitFor(() =>
      expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "git_fetch")).toBe(true)
    );
  });

  it("stays visible with the workspace's branch when a file tab is open instead of the workspace", () => {
    mockBranch(null);
    useWorkbench.setState({
      projects: [makeProject({ id: "p", name: "Alpha" })],
      workspaces: [
        makeWorkspace({ id: "ws", projectId: "p", branch: "feature/x", agentBackend: "codex", worktreePath: "/wt/ws" }),
      ],
      // Opening a file tab clears activeWorkspaceId — the breadcrumb must fall
      // back to the file tab's worktree instead of disappearing.
      activeWorkspaceId: null,
      activeFileTabId: "file:/wt/ws/a.ts",
      fileTabs: [
        { id: "file:/wt/ws/a.ts", kind: "file", path: "/wt/ws/a.ts", worktreePath: "/wt/ws", workspaceId: "ws", preview: false, dirty: false, mode: "edit", viewed: false },
      ],
    });
    renderWithProviders(<EditorBreadcrumb />);
    expect(screen.getByTestId("editor-breadcrumb-branch")).toHaveTextContent("feature/x");
  });

  it("disables the sync control and performs no action when diverged", async () => {
    mockBranch({ upstream: "origin/viper", ahead: 1, behind: 2 });
    mountActive();
    renderWithProviders(<EditorBreadcrumb />);
    const sync = await screen.findByTestId("editor-breadcrumb-sync");
    expect(sync).toHaveTextContent("↑1 ↓2");
    expect(sync).toBeDisabled();
    await userEvent.click(sync);
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "git_push" || cmd === "git_pull")).toBe(false);
  });
});
