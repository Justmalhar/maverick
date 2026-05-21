import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import CherryPickDialog from "./CherryPickDialog";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("CherryPickDialog", () => {
  it("submits when SHA is set; closes after success", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined as never);
    const onOpen = vi.fn();
    renderWithProviders(<CherryPickDialog open onOpenChange={onOpen} worktreePath="/wt" />);
    await userEvent.type(screen.getByTestId("cherrypick-sha"), "abc1234");
    await userEvent.click(screen.getByTestId("cherrypick-confirm"));
    expect(invoke).toHaveBeenCalledWith("git_cherry_pick", { worktreePath: "/wt", sha: "abc1234" });
    expect(onOpen).toHaveBeenCalledWith(false);
  });

  it("surfaces errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("bad"));
    renderWithProviders(<CherryPickDialog open onOpenChange={() => {}} worktreePath="/wt" />);
    await userEvent.type(screen.getByTestId("cherrypick-sha"), "abc");
    await userEvent.click(screen.getByTestId("cherrypick-confirm"));
    expect(await screen.findByText(/bad/)).toBeInTheDocument();
  });

  it("cancel closes the dialog and resets when reopened", async () => {
    const onOpen = vi.fn();
    const { rerender } = renderWithProviders(<CherryPickDialog open onOpenChange={onOpen} worktreePath="/wt" />);
    await userEvent.click(screen.getByText("Cancel"));
    expect(onOpen).toHaveBeenCalledWith(false);
    rerender(<CherryPickDialog open={false} onOpenChange={onOpen} worktreePath="/wt" />);
  });

  it("empty SHA disables confirm", () => {
    renderWithProviders(<CherryPickDialog open onOpenChange={() => {}} worktreePath="/wt" />);
    expect(screen.getByTestId("cherrypick-confirm")).toBeDisabled();
  });
});
