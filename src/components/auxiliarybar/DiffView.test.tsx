import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { DiffView } from "./DiffView";
import { useWorkbench } from "@/state/store";
import { makeWorkspace, makeDiff, makeDiffFile } from "@/test/fixtures";

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

  it("AI Code Review writes a review prompt and switches the workspace to agent mode", async () => {
    activeWorkspaceWithDiff();
    vi.mocked(invoke)
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never) // initial diff_get
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never) // runAiReview diff_get
      .mockResolvedValueOnce(undefined as never); // pty_write
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("diff-ai-review"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_write", expect.objectContaining({ ptyId: "w1" }))
    );
    expect(useWorkbench.getState().editorModes["w1"]).toBe("agent");
  });

  it("AI Code Review logs an error when the review call fails", async () => {
    activeWorkspaceWithDiff();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke)
      .mockResolvedValueOnce(makeDiff({ files: [makeDiffFile({ path: "a.ts" })] }) as never) // initial diff_get
      .mockRejectedValueOnce(new Error("diff failed")); // runAiReview diff_get
    renderWithProviders(<DiffView />);
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("diff-ai-review"));
    await waitFor(() => expect(errSpy).toHaveBeenCalledWith("AI review failed", expect.any(Error)));
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
});
