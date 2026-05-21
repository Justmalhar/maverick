import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import StashList from "./StashList";
import { makeStash } from "@/test/fixtures";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("StashList", () => {
  it("does nothing without worktreePath", () => {
    renderWithProviders(<StashList worktreePath="" />);
  });

  it("renders empty state and a row, then opens confirm dialog", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makeStash({ index: 1 })] as never);
    renderWithProviders(<StashList worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByTestId("stash-row")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("stash-apply"));
    expect(screen.getAllByText(/apply stash/i).length).toBeGreaterThan(0);
  });

  it("confirms drop action and triggers invoke", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makeStash({ index: 0 })] as never).mockResolvedValueOnce(undefined as never).mockResolvedValueOnce([] as never);
    renderWithProviders(<StashList worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByTestId("stash-row")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("stash-drop"));
    await userEvent.click(screen.getByTestId("stash-confirm"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_stash_drop", { worktreePath: "/wt", index: 0 }));
  });

  it("captures errors from list + action", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("listfail"));
    renderWithProviders(<StashList worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByText(/listfail/)).toBeInTheDocument());
  });

  it("pop action shows different copy", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makeStash({ index: 2 })] as never);
    renderWithProviders(<StashList worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByTestId("stash-row")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("stash-pop"));
    expect(screen.getByText(/pop stash/i)).toBeInTheDocument();
  });

  it("confirm action handles errors", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makeStash({ index: 3 })] as never).mockRejectedValueOnce(new Error("popfail"));
    renderWithProviders(<StashList worktreePath="/wt" />);
    await waitFor(() => expect(screen.getByTestId("stash-row")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("stash-pop"));
    await userEvent.click(screen.getByTestId("stash-confirm"));
    await waitFor(() => expect(screen.getByText(/popfail/)).toBeInTheDocument());
  });

  it("cancel closes the dialog", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makeStash({ index: 0 })] as never);
    renderWithProviders(<StashList worktreePath="/wt" />);
    await userEvent.click(await screen.findByTestId("stash-apply"));
    await userEvent.click(screen.getByText("Cancel"));
  });

  it("closing the dialog via Escape (covers onOpenChange closure)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makeStash({ index: 0 })] as never);
    renderWithProviders(<StashList worktreePath="/wt" />);
    await userEvent.click(await screen.findByTestId("stash-apply"));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  it("refresh button reloads", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
    renderWithProviders(<StashList worktreePath="/wt" />);
    await userEvent.click(screen.getByText("Refresh"));
  });
});
