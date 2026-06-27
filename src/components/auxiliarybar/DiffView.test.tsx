import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor, act } from "@/test/utils";
import { DiffView } from "./DiffView";
import { useWorkbench } from "@/state/store";
import { makeWorkspace, makeDiff, makeDiffFile } from "@/test/fixtures";
import { fileTabId } from "@/state/store";
import { __testing__ as terminalLeafTesting } from "@/components/editor/terminal/leaf-registry";
import { useReviewComments } from "@/lib/stores/review-comments";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";

const initial = useWorkbench.getState();

function activeWorkspaceWithDiff() {
  useWorkbench.setState({
    ...initial,
    workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
    activeWorkspaceId: "w1",
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  terminalLeafTesting.leafPtyCache.clear();
  useReviewComments.setState({ comments: [] });
  useAgentStatusStore.setState({ statuses: {} });
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
});

afterEach(() => {
  vi.restoreAllMocks();
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
    expect(screen.getByTestId("diff-file-a.ts")).toBeInTheDocument();
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

  it("AI Code Review writes a review prompt and brings the workspace to the front", async () => {
    activeWorkspaceWithDiff();
    // The agent runs in the primary leaf; pty_write must target its live PTY id.
    terminalLeafTesting.leafPtyCache.set("w1-1", "pty-w1-1");
    vi.mocked(invoke)
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never) // initial diff_get
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never) // runAiReview diff_get
      .mockResolvedValueOnce(undefined as never); // pty_write
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("diff-ai-review"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_write", expect.objectContaining({ ptyId: "pty-w1-1" }))
    );
    // onAgentFocus brings the reviewed workspace to the front (no editor mode).
    await waitFor(() => expect(useWorkbench.getState().activeWorkspaceId).toBe("w1"));
  });

  it("Draft PR sends a create-PR prompt to the agent PTY", async () => {
    activeWorkspaceWithDiff();
    terminalLeafTesting.leafPtyCache.set("w1-1", "pty-w1-1");
    vi.mocked(invoke)
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never) // initial diff_get
      .mockResolvedValueOnce(undefined as never); // pty_write
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("diff-draft-pr"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_write",
        expect.objectContaining({ ptyId: "pty-w1-1", data: expect.stringContaining("pull request") })
      )
    );
  });

  it("Fix errors sends a fix-errors prompt to the agent PTY", async () => {
    activeWorkspaceWithDiff();
    terminalLeafTesting.leafPtyCache.set("w1-1", "pty-w1-1");
    vi.mocked(invoke)
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never) // initial diff_get
      .mockResolvedValueOnce(undefined as never); // pty_write
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("diff-fix-errors"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_write",
        expect.objectContaining({ ptyId: "pty-w1-1", data: expect.stringContaining("fix any errors") })
      )
    );
  });

  it("AI Code Review logs an error when the review call fails", async () => {
    activeWorkspaceWithDiff();
    terminalLeafTesting.leafPtyCache.set("w1-1", "pty-w1-1"); // reachable agent → button enabled
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke)
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never) // initial diff_get
      .mockRejectedValueOnce(new Error("diff failed")); // runAiReview diff_get
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("diff-ai-review"));
    await waitFor(() => expect(errSpy).toHaveBeenCalledWith("AI review failed", expect.any(Error)));
  });

  it("disables AI Code Review when the workspace has no live agent PTY", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt", agentBackend: "claude-code" })],
      activeWorkspaceId: "w1",
    });
    // No PTY seeded — the agent is unreachable, so the action is gated off rather
    // than presenting as enabled-but-inert.
    vi.mocked(invoke).mockResolvedValue(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never);
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());
    expect(screen.getByTestId("diff-ai-review")).toBeDisabled();
  });

  it("Create PR confirms, calls pr_create, and shows the resulting URL", async () => {
    activeWorkspaceWithDiff();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(invoke)
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile()] }) as never) // diff_get
      .mockResolvedValueOnce({ url: "https://github.com/o/r/pull/7" } as never); // pr_create
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("diff-create-pr"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pr_create", expect.objectContaining({ worktreePath: "/wt" }))
    );
    expect(await screen.findByTestId("diff-pr-link")).toHaveAttribute(
      "href",
      "https://github.com/o/r/pull/7"
    );
  });

  it("Create PR is a no-op when the confirm dialog is dismissed", async () => {
    activeWorkspaceWithDiff();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(invoke).mockResolvedValueOnce(makeDiff({ files: [makeDiffFile()] }) as never);
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("diff-create-pr"));
    expect(invoke).not.toHaveBeenCalledWith("pr_create", expect.anything());
  });

  it("Create PR surfaces an error when gh fails", async () => {
    activeWorkspaceWithDiff();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(invoke)
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile()] }) as never) // diff_get
      .mockRejectedValueOnce(new Error("gh: not authenticated")); // pr_create
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("diff-create-pr"));
    expect(await screen.findByTestId("diff-pr-error")).toHaveTextContent("gh: not authenticated");
  });

  it("shows a 'send comments to agent' button only when the workspace has comments", async () => {
    activeWorkspaceWithDiff();
    vi.mocked(invoke).mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never);
    const { rerender } = renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());
    expect(screen.queryByTestId("diff-send-comments")).not.toBeInTheDocument();

    act(() => {
      useReviewComments.getState().addComment({ workspaceId: "w1", file: "a.ts", line: 3, side: "new", body: "nit" });
    });
    rerender(<DiffView />);
    expect(screen.getByTestId("diff-send-comments")).toHaveTextContent("Send 1 comment to agent");
  });

  it("disables the send button while the agent is working", async () => {
    activeWorkspaceWithDiff();
    useAgentStatusStore.setState({ statuses: { w1: "working" } });
    useReviewComments.getState().addComment({ workspaceId: "w1", file: "a.ts", line: 3, side: "new", body: "nit" });
    vi.mocked(invoke).mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never);
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());
    expect(screen.getByTestId("diff-send-comments")).toBeDisabled();
  });

  it("sends the batched comments to the agent PTY and clears them when idle", async () => {
    activeWorkspaceWithDiff();
    terminalLeafTesting.leafPtyCache.set("w1-1", "pty-w1-1");
    useReviewComments.getState().addComment({ workspaceId: "w1", file: "src/a.ts", line: 9, side: "new", body: "tidy this" });
    vi.mocked(invoke).mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "src/a.ts" })] }) as never);
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("diff-send-comments"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_write",
        expect.objectContaining({ ptyId: "pty-w1-1", data: expect.stringContaining("Re: src/a.ts:9 — tidy this") })
      )
    );
    expect(useReviewComments.getState().comments).toHaveLength(0);
  });

  it("onDraftPr catch block: logs error when sendAgentPrompt throws", async () => {
    activeWorkspaceWithDiff();
    terminalLeafTesting.leafPtyCache.set("w1-1", "pty-w1-1");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke)
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never) // diff_get
      .mockRejectedValueOnce(new Error("draft-pr-failed")); // pty_write throws
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("diff-draft-pr"));
    await waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith("Draft PR failed", expect.any(Error))
    );
    errSpy.mockRestore();
  });

  it("onFixErrors catch block: logs error when sendAgentPrompt throws", async () => {
    activeWorkspaceWithDiff();
    terminalLeafTesting.leafPtyCache.set("w1-1", "pty-w1-1");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke)
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never) // diff_get
      .mockRejectedValueOnce(new Error("pty broken")); // pty_write
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("diff-fix-errors"));
    await waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith("Fix errors failed", expect.any(Error))
    );
    errSpy.mockRestore();
  });

  it("onSendComments catch block: logs error when sendReviewComments throws", async () => {
    activeWorkspaceWithDiff();
    terminalLeafTesting.leafPtyCache.set("w1-1", "pty-w1-1");
    useReviewComments.getState().addComment({ workspaceId: "w1", file: "a.ts", line: 1, side: "new", body: "test" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke)
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never) // diff_get
      .mockRejectedValueOnce(new Error("agent failed")); // pty_write
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("diff-send-comments"));
    await waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith("Send review comments failed", expect.any(Error))
    );
    errSpy.mockRestore();
  });

  it("clicking a changed-file row opens a diff tab for that file", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
      activeWorkspaceId: "w1",
      fileTabs: [],
      activeFileTabId: null,
    });
    vi.mocked(invoke).mockResolvedValueOnce(
      makeDiff({ files: [makeDiffFile({ path: "src/a.ts", status: "M" })] }) as never
    );
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("diff-file-src/a.ts"));
    const state = useWorkbench.getState();
    expect(state.fileTabs).toHaveLength(1);
    expect(state.fileTabs[0]).toMatchObject({
      id: fileTabId("diff", "/wt/src/a.ts"),
      kind: "diff",
      path: "/wt/src/a.ts",
      worktreePath: "/wt",
      preview: true,
    });
  });
});
