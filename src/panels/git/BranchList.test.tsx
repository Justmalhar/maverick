import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import BranchList from "./BranchList";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("BranchList", () => {
  it("does nothing when worktreePath empty", () => {
    renderWithProviders(<BranchList worktreePath="" />);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("renders local + remote sections and filters", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "main", isRemote: false, isCurrent: true },
      { name: "feat-a", isRemote: false, isCurrent: false, ahead: 2, behind: 1 },
      { name: "origin/main", isRemote: true, isCurrent: false },
    ] as never);
    renderWithProviders(<BranchList worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());
    expect(screen.getAllByTestId("branch-row").length).toBe(3);

    await userEvent.type(screen.getByTestId("branch-search"), "feat");
    expect(screen.getAllByTestId("branch-row").length).toBe(1);
  });

  it("checkout invokes git_checkout and refreshes", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ name: "feat", isRemote: false, isCurrent: false }] as never)
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce([] as never);
    renderWithProviders(<BranchList worktreePath="/wt" />);
    await userEvent.click(await screen.findByTestId("branch-checkout"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_checkout", { worktreePath: "/wt", branch: "feat" }));
  });

  it("checkout surfaces errors", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ name: "feat", isRemote: false, isCurrent: false }] as never)
      .mockRejectedValueOnce(new Error("co-fail"));
    renderWithProviders(<BranchList worktreePath="/wt" />);
    await userEvent.click(await screen.findByTestId("branch-checkout"));
    await waitFor(() => expect(screen.getByText(/co-fail/)).toBeInTheDocument());
  });

  it("captures list errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("listfail"));
    renderWithProviders(<BranchList worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText(/listfail/)).toBeInTheDocument());
  });

  it("refresh button forces reload", async () => {
    vi.mocked(invoke).mockResolvedValue([] as never);
    renderWithProviders(<BranchList worktreePath="/wt" />);
    await userEvent.click(screen.getByText("Refresh"));
  });

  it("checkout works for remote branches too (covers remote closure)", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([
        { name: "origin/feature", isRemote: true, isCurrent: false },
      ] as never)
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce([] as never);
    renderWithProviders(<BranchList worktreePath="/wt" />);
    await userEvent.click(await screen.findByTestId("branch-checkout"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_checkout", { worktreePath: "/wt", branch: "origin/feature" }));
  });
});
