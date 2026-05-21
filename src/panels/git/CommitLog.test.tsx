import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import CommitLog from "./CommitLog";
import { makeCommit } from "@/test/fixtures";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("CommitLog", () => {
  it("does nothing when worktreePath is empty", () => {
    renderWithProviders(<CommitLog worktreePath="" />);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows loading + then commit rows; clicking calls onSelect", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makeCommit({ sha: "abc1234" })] as never);
    const onSelect = vi.fn();
    renderWithProviders(<CommitLog worktreePath="/wt" onSelect={onSelect} />);
    expect(screen.getByText(/Loading log/)).toBeInTheDocument();
    const row = await screen.findByTestId("commit-row");
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalled();
  });

  it("renders an error banner on failure", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
    renderWithProviders(<CommitLog worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText(/Failed/)).toBeInTheDocument());
  });

  it("shows the empty state when commits return is empty", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never);
    renderWithProviders(<CommitLog worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText("No commits")).toBeInTheDocument());
  });

  it("uses a custom limit when provided", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never);
    renderWithProviders(<CommitLog worktreePath="/wt" limit={42} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_log", { worktreePath: "/wt", limit: 42 }));
  });
});
