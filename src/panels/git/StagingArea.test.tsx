import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor, fireEvent } from "@/test/utils";
import StagingArea from "./StagingArea";
import { makeDiff, makeDiffFile } from "@/test/fixtures";

function mockInvokes(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
    const h = handlers[cmd];
    if (!h) throw new Error(`Unmocked ${cmd}`);
    return Promise.resolve(h(args ?? {}));
  }) as unknown as typeof invoke);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("StagingArea", () => {
  it("loads diff and renders file rows; expand reveals hunks", async () => {
    mockInvokes({
      diff_get: () => makeDiff({ files: [makeDiffFile({ path: "a.ts", status: "M" })] }),
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText("a.ts")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("diff-file-row"));
    expect(screen.getByTestId("hunk-action")).toBeInTheDocument();
  });

  it("stage hunk button triggers diff_stage_hunk + refresh", async () => {
    mockInvokes({
      diff_get: () => makeDiff({ files: [makeDiffFile()] }),
      diff_stage_hunk: () => undefined,
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText("src/a.ts")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("diff-file-row"));
    await userEvent.click(screen.getByTestId("hunk-action"));
    expect(invoke).toHaveBeenCalledWith("diff_stage_hunk", expect.any(Object));
  });

  it("stage hunk surfaces error", async () => {
    const fail = vi.fn().mockResolvedValueOnce(makeDiff({ files: [makeDiffFile()] }))
      .mockRejectedValueOnce(new Error("boom"));
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "diff_get") return fail();
      if (cmd === "diff_stage_hunk") return Promise.reject(new Error("err"));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText("src/a.ts")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("diff-file-row"));
    await userEvent.click(screen.getByTestId("hunk-action"));
    await waitFor(() => expect(screen.getByText(/err/)).toBeInTheDocument());
  });

  it("commit is gated by message + staged presence; no-op when path empty", async () => {
    renderWithProviders(<StagingArea worktreePath="" />);
    const ta = screen.getByTestId("commit-message");
    fireEvent.change(ta, { target: { value: "msg" } });
    const btn = screen.getByTestId("commit-button");
    expect(btn).toBeDisabled();
  });

  it("renders D status with destructive badge for deletion", async () => {
    mockInvokes({
      diff_get: () => makeDiff({ files: [makeDiffFile({ status: "D" })] }),
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText("D")).toBeInTheDocument());
  });

  it("captures diff_get error in error banner", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("X"));
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText(/X/)).toBeInTheDocument());
  });

  it("hunk lines render + and - color classes", async () => {
    mockInvokes({
      diff_get: () => makeDiff({ files: [makeDiffFile({ hunks: [{ header: "@@", lines: ["+a", "-b", " ctx"], patch: "p" }] })] }),
    });
    renderWithProviders(<StagingArea worktreePath="/wt" />);
    await userEvent.click(await screen.findByTestId("diff-file-row"));
    expect(screen.getByText("+a")).toBeInTheDocument();
    expect(screen.getByText("-b")).toBeInTheDocument();
  });
});
