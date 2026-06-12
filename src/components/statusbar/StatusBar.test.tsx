import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { StatusBar } from "./StatusBar";
import { useWorkbench } from "@/state/store";
import { makeBackend, makeWorkspace } from "@/test/fixtures";
import type { Branch } from "@/lib/ipc";

const initial = useWorkbench.getState();

function branch(overrides: Partial<Branch> = {}): Branch {
  return { name: "main", isRemote: false, isCurrent: true, ...overrides };
}

const USAGE = { workspaceId: "w1", tokensUsed: 0, contextWindow: 200000, sessionCostEstimate: 0 };

/** Resolve the cross-cutting commands StatusBar mounts (context usage, bell). */
function defaultResolve(cmd: string): unknown {
  if (cmd === "context_usage") return USAGE;
  if (cmd === "notify_list") return [];
  if (cmd === "notify_unread_count") return { count: 0 };
  if (cmd === "caffeinate_status") return { active: false };
  return undefined;
}

/** Mock invoke; git_branch_list returns the supplied current branch. */
function mockBranchList(b: Branch | null) {
  vi.mocked(invoke).mockImplementation(((cmd: string) => {
    if (cmd === "git_branch_list") return Promise.resolve(b ? [b] : []);
    return Promise.resolve(defaultResolve(cmd));
  }) as unknown as typeof invoke);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(((cmd: string) =>
    Promise.resolve(defaultResolve(cmd))) as unknown as typeof invoke);
  useWorkbench.setState({ ...initial, workspaces: [], backends: [], activeWorkspaceId: null });
});

describe("StatusBar", () => {
  it("renders no backends placeholder + workspace count", () => {
    renderWithProviders(<StatusBar />);
    expect(screen.getByTestId("statusbar-backends")).toHaveTextContent("no backends");
    expect(screen.getByTestId("statusbar-workspaces")).toHaveTextContent("0 ws");
  });

  it("does not render the sync indicator without an active workspace", () => {
    renderWithProviders(<StatusBar />);
    expect(screen.queryByTestId("statusbar-sync")).not.toBeInTheDocument();
  });

  it("shows N backends when multiple are configured but none active", () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude", active: false }), makeBackend({ id: "codex", active: false })],
      workspaces: [],
      activeWorkspaceId: null,
    });
    renderWithProviders(<StatusBar />);
    expect(screen.getByTestId("statusbar-backends")).toHaveTextContent("2 backends");
  });

  it("renders active backend chip(s) and branch when active workspace exists", () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude", name: "claude", active: true }), makeBackend({ id: "codex", name: "codex", active: false })],
      workspaces: [makeWorkspace({ id: "w1", branch: "feat" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<StatusBar />);
    expect(screen.getByTestId("statusbar-backends")).toHaveTextContent("claude");
    expect(screen.getByTestId("statusbar-branch")).toHaveTextContent("feat");
    expect(screen.getByTestId("statusbar-workspaces")).toHaveTextContent("1 ws");
  });

  it("falls back to plain 'sync' when active workspace has no upstream", async () => {
    mockBranchList(branch({ upstream: undefined }));
    useWorkbench.setState({
      ...initial,
      backends: [],
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<StatusBar />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_branch_list", { worktreePath: "/tmp/demo/.maverick/worktrees/ws-1" }));
    expect(screen.getByTestId("statusbar-sync")).toHaveTextContent("sync");
  });

  it("shows ↑N indicator and pushes on click when ahead", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "git_branch_list")
        return Promise.resolve([branch({ upstream: "origin/main", ahead: 2, behind: 0 })]);
      if (cmd === "git_push") return Promise.resolve({ ok: true });
      return Promise.resolve(defaultResolve(cmd));
    }) as unknown as typeof invoke);
    useWorkbench.setState({
      ...initial,
      backends: [],
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<StatusBar />);
    await waitFor(() => expect(screen.getByTestId("statusbar-sync")).toHaveTextContent("↑2"));
    await userEvent.click(screen.getByTestId("statusbar-sync"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_push", { worktreePath: "/tmp/demo/.maverick/worktrees/ws-1", remote: undefined, branch: undefined }));
  });

  it("shows diverged indicator that is not clickable", async () => {
    mockBranchList(branch({ upstream: "origin/main", ahead: 1, behind: 1 }));
    useWorkbench.setState({
      ...initial,
      backends: [],
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<StatusBar />);
    await waitFor(() => expect(screen.getByTestId("statusbar-sync")).toHaveTextContent("↑1 ↓1"));
    // diverged → rendered as a non-button div (onClick undefined)
    expect(screen.getByTestId("statusbar-sync").tagName).toBe("DIV");
  });
});
