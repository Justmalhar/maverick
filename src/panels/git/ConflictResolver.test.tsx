import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import ConflictResolver from "./ConflictResolver";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
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

  it("captures errors from resolve", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ filePath: "a.ts", hunkIndex: 0, ours: ["o"], theirs: ["t"] }] as never)
      .mockRejectedValueOnce(new Error("resolveX"));
    renderWithProviders(<ConflictResolver worktreePath="/wt" />);
    await userEvent.click(await screen.findByTestId("resolve-ours"));
    await waitFor(() => expect(screen.getByText(/resolveX/)).toBeInTheDocument());
  });
});
