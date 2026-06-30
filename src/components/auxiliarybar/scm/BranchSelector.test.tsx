import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BranchSelector } from "./BranchSelector";
import * as tauri from "@/lib/tauri";

vi.mock("@/lib/tauri");

describe("BranchSelector", () => {
  beforeEach(() => {
    vi.mocked(tauri.gitBranchList).mockResolvedValue([
      { name: "main", isRemote: false, isCurrent: false },
      { name: "feat/x", isRemote: false, isCurrent: true },
      { name: "origin/main", isRemote: true, isCurrent: false },
    ]);
    vi.mocked(tauri.gitCheckout).mockResolvedValue({ ok: true });
  });

  test("shows current branch name and ahead/behind", () => {
    render(<BranchSelector worktreePath="/w" currentName="feat/x" ahead={2} behind={1} onChanged={() => {}} />);
    expect(screen.getByTestId("scm-branch")).toHaveTextContent("feat/x");
    expect(screen.getByTestId("scm-ahead")).toHaveTextContent("↑2");
    expect(screen.getByTestId("scm-behind")).toHaveTextContent("↓1");
  });

  test("opening lists only local branches and checking out calls gitCheckout", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<BranchSelector worktreePath="/w" currentName="feat/x" ahead={0} behind={0} onChanged={onChanged} />);
    await user.click(screen.getByTestId("scm-branch-selector"));
    await waitFor(() => expect(screen.getByTestId("scm-branch-item-main")).toBeInTheDocument());
    expect(screen.queryByTestId("scm-branch-item-origin/main")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("scm-branch-item-main"));
    await waitFor(() => expect(tauri.gitCheckout).toHaveBeenCalledWith("/w", "main"));
    expect(onChanged).toHaveBeenCalled();
  });
});
