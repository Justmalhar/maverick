import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import ConflictResolver from "./ConflictResolver";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";
import { __testing__ as terminalLeafTesting } from "@/components/editor/terminal/leaf-registry";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  terminalLeafTesting.leafPtyCache.clear();
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
});

describe("ConflictResolver", () => {
  it("does nothing without path", () => {
    renderWithProviders(<ConflictResolver worktreePath="" />);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("renders 'no conflicts' when list empty", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never);
    renderWithProviders(<ConflictResolver worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText(/No conflicts/)).toBeInTheDocument());
  });

  it.each([["ours"], ["theirs"], ["both"]] as const)("resolves with %s", async (resolution) => {
    const hunk = { filePath: "a.ts", hunkIndex: 0, ours: ["o"], theirs: ["t"] };
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "git_conflicts") return [hunk];
      return undefined;
    }) as unknown as typeof invoke);
    renderWithProviders(<ConflictResolver worktreePath="/wt" />);
    await userEvent.click(await screen.findByTestId(`resolve-${resolution}`));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("git_resolve_conflict", expect.objectContaining({ resolution }))
    );
    cleanup();
  });

  it("captures errors from list", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("listX"));
    renderWithProviders(<ConflictResolver worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText(/listX/)).toBeInTheDocument());
  });

  it("'Resolve with AI' sends a resolve-conflicts prompt to the agent PTY", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    terminalLeafTesting.leafPtyCache.set("w1-1", "pty-w1-1");
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "git_conflicts") return [{ filePath: "a.ts", hunkIndex: 0, ours: ["o"], theirs: ["t"] }];
      return undefined;
    }) as unknown as typeof invoke);
    renderWithProviders(<ConflictResolver worktreePath="/wt" />);
    await userEvent.click(await screen.findByTestId("conflict-resolve-ai"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_write",
        expect.objectContaining({ ptyId: "pty-w1-1", data: expect.stringContaining("merge conflicts") })
      )
    );
  });

  it("captures errors from resolve", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ filePath: "a.ts", hunkIndex: 0, ours: ["o"], theirs: ["t"] }] as never)
      .mockRejectedValueOnce(new Error("resolveX"));
    renderWithProviders(<ConflictResolver worktreePath="/wt" />);
    await userEvent.click(await screen.findByTestId("resolve-ours"));
    await waitFor(() => expect(screen.getByText(/resolveX/)).toBeInTheDocument());
  });

  it("catches error from resolveWithAI when sendAgentPrompt throws (lines 35-36)", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
    });
    terminalLeafTesting.leafPtyCache.set("w1-1", "pty-w1-1");
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "git_conflicts") {
        return [{ filePath: "a.ts", hunkIndex: 0, ours: ["o"], theirs: ["t"] }];
      }
      if (cmd === "pty_write") throw new Error("pty-error");
      return undefined;
    }) as unknown as typeof invoke);
    renderWithProviders(<ConflictResolver worktreePath="/wt" />);
    await userEvent.click(await screen.findByTestId("conflict-resolve-ai"));
    await waitFor(() => expect(screen.getByText(/pty-error/)).toBeInTheDocument());
  });
});
