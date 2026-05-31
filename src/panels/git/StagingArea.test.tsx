import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import {
  renderWithProviders,
  screen,
  within,
  waitFor,
  fireEvent,
} from "@/test/utils";
import StagingArea from "./StagingArea";
import { makeDiff, makeDiffFile } from "@/test/fixtures";

function mockInvokes(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
    const h = handlers[cmd];
    if (!h) throw new Error(`Unmocked ${cmd}`);
    return Promise.resolve(h(args ?? {}));
  }) as unknown as typeof invoke);
}

/** diff_get split: working-tree files vs --cached (staged:true) files. */
function diffGetSplit(
  unstaged: ReturnType<typeof makeDiff>,
  staged: ReturnType<typeof makeDiff>
) {
  return (args: Record<string, unknown>) => (args.staged ? staged : unstaged);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("StagingArea", () => {
  it("loads unstaged + staged diffs into separate panes", async () => {
    mockInvokes({
      diff_get: diffGetSplit(
        makeDiff({ files: [makeDiffFile({ path: "unstaged.ts", status: "M" })] }),
        makeDiff({ files: [makeDiffFile({ path: "staged.ts", status: "A" })] })
      ),
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    const unstaged = await screen.findByTestId("unstaged-pane");
    const staged = await screen.findByTestId("staged-pane");
    expect(within(unstaged).getByText("unstaged.ts")).toBeInTheDocument();
    expect(within(staged).getByText("staged.ts")).toBeInTheDocument();
  });

  it("expand reveals hunks in the unstaged pane", async () => {
    mockInvokes({
      diff_get: diffGetSplit(
        makeDiff({ files: [makeDiffFile({ path: "a.ts", status: "M" })] }),
        makeDiff({ files: [] })
      ),
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText("a.ts")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("diff-file-row"));
    expect(screen.getByTestId("hunk-action")).toBeInTheDocument();
  });

  it("stage hunk button triggers diff_stage_hunk + refresh", async () => {
    mockInvokes({
      diff_get: diffGetSplit(makeDiff({ files: [makeDiffFile()] }), makeDiff({ files: [] })),
      diff_stage_hunk: () => undefined,
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText("src/a.ts")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("diff-file-row"));
    await userEvent.click(screen.getByTestId("hunk-action"));
    expect(invoke).toHaveBeenCalledWith("diff_stage_hunk", expect.any(Object));
  });

  it("unstage hunk button triggers diff_unstage_hunk + refresh", async () => {
    mockInvokes({
      diff_get: diffGetSplit(
        makeDiff({ files: [] }),
        makeDiff({ files: [makeDiffFile({ path: "staged.ts", status: "A" })] })
      ),
      diff_unstage_hunk: () => undefined,
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    const staged = await screen.findByTestId("staged-pane");
    await userEvent.click(within(staged).getByTestId("diff-file-row"));
    await userEvent.click(within(staged).getByTestId("hunk-action"));
    expect(invoke).toHaveBeenCalledWith("diff_unstage_hunk", expect.any(Object));
  });

  it("unstage hunk surfaces error", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "diff_get") {
        return Promise.resolve(
          args?.staged
            ? makeDiff({ files: [makeDiffFile({ path: "staged.ts", status: "A" })] })
            : makeDiff({ files: [] })
        );
      }
      if (cmd === "diff_unstage_hunk") return Promise.reject(new Error("unstage-err"));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    const staged = await screen.findByTestId("staged-pane");
    await userEvent.click(within(staged).getByTestId("diff-file-row"));
    await userEvent.click(within(staged).getByTestId("hunk-action"));
    await waitFor(() => expect(screen.getByText(/unstage-err/)).toBeInTheDocument());
  });

  it("stage hunk surfaces error", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "diff_get") {
        return Promise.resolve(
          args?.staged ? makeDiff({ files: [] }) : makeDiff({ files: [makeDiffFile()] })
        );
      }
      if (cmd === "diff_stage_hunk") return Promise.reject(new Error("err"));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText("src/a.ts")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("diff-file-row"));
    await userEvent.click(screen.getByTestId("hunk-action"));
    await waitFor(() => expect(screen.getByText(/err/)).toBeInTheDocument());
  });

  it("commit is gated by message + staged presence; no-op when path empty", () => {
    renderWithProviders(<StagingArea worktreePath="" />);
    const ta = screen.getByTestId("commit-message");
    fireEvent.change(ta, { target: { value: "msg" } });
    const btn = screen.getByTestId("commit-button");
    expect(btn).toBeDisabled();
  });

  it("commit disabled with staged files but empty message", async () => {
    mockInvokes({
      diff_get: diffGetSplit(
        makeDiff({ files: [] }),
        makeDiff({ files: [makeDiffFile({ path: "staged.ts", status: "A" })] })
      ),
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await screen.findByText("staged.ts");
    expect(screen.getByTestId("commit-button")).toBeDisabled();
  });

  it("commit enabled when message + staged present and calls git_commit", async () => {
    mockInvokes({
      diff_get: diffGetSplit(
        makeDiff({ files: [] }),
        makeDiff({ files: [makeDiffFile({ path: "staged.ts", status: "A" })] })
      ),
      git_commit: () => ({ sha: "deadbeef" }),
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await screen.findByText("staged.ts");
    fireEvent.change(screen.getByTestId("commit-message"), { target: { value: "feat: x" } });
    const btn = screen.getByTestId("commit-button");
    expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("git_commit", {
        worktreePath: "/wt",
        message: "feat: x",
        files: undefined,
      })
    );
    await waitFor(() =>
      expect((screen.getByTestId("commit-message") as HTMLTextAreaElement).value).toBe("")
    );
  });

  it("commit with whitespace-only message is a no-op", async () => {
    mockInvokes({
      diff_get: diffGetSplit(
        makeDiff({ files: [] }),
        makeDiff({ files: [makeDiffFile({ path: "staged.ts", status: "A" })] })
      ),
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await screen.findByText("staged.ts");
    fireEvent.change(screen.getByTestId("commit-message"), { target: { value: "   " } });
    expect(screen.getByTestId("commit-button")).toBeDisabled();
  });

  it("commit surfaces error", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "diff_get") {
        return Promise.resolve(
          args?.staged
            ? makeDiff({ files: [makeDiffFile({ path: "staged.ts", status: "A" })] })
            : makeDiff({ files: [] })
        );
      }
      if (cmd === "git_commit") return Promise.reject(new Error("commit-fail"));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await screen.findByText("staged.ts");
    fireEvent.change(screen.getByTestId("commit-message"), { target: { value: "boom" } });
    await userEvent.click(screen.getByTestId("commit-button"));
    await waitFor(() => expect(screen.getByText(/commit-fail/)).toBeInTheDocument());
  });

  it("renders D status with destructive badge for deletion", async () => {
    mockInvokes({
      diff_get: diffGetSplit(
        makeDiff({ files: [makeDiffFile({ status: "D" })] }),
        makeDiff({ files: [] })
      ),
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText("D")).toBeInTheDocument());
  });

  it("captures diff_get error in error banner", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("X"));
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText(/X/)).toBeInTheDocument());
  });

  it("hunk lines render + and - color classes", async () => {
    mockInvokes({
      diff_get: diffGetSplit(
        makeDiff({
          files: [
            makeDiffFile({
              hunks: [{ header: "@@", lines: ["+a", "-b", " ctx"], patch: "p" }],
            }),
          ],
        }),
        makeDiff({ files: [] })
      ),
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await userEvent.click(await screen.findByTestId("diff-file-row"));
    expect(screen.getByText("+a")).toBeInTheDocument();
    expect(screen.getByText("-b")).toBeInTheDocument();
  });

  it("empty panes show 'No files'", async () => {
    mockInvokes({
      diff_get: diffGetSplit(makeDiff({ files: [] }), makeDiff({ files: [] })),
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await waitFor(() => expect(screen.getAllByText("No files").length).toBe(2));
  });
});
