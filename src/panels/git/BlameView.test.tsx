import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import BlameView from "./BlameView";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("BlameView", () => {
  it("does not load without filePath", () => {
    renderWithProviders(<BlameView worktreePath="/wt" />);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("auto-loads when initialFile is provided", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { sha: "abcdef1", author: "M", timestamp: 0, lineNumber: 1, content: "hello" },
    ] as never);
    renderWithProviders(<BlameView worktreePath="/wt" initialFile="a.ts" />);
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
  });

  it("renders error on failure", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("bf"));
    renderWithProviders(<BlameView worktreePath="/wt" initialFile="a.ts" />);
    await waitFor(() => expect(screen.getByText(/bf/)).toBeInTheDocument());
  });

  it("manual blame button triggers load", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never);
    renderWithProviders(<BlameView worktreePath="/wt" />);
    await userEvent.type(screen.getByTestId("blame-file-input"), "b.ts");
    await userEvent.click(screen.getByTestId("blame-load"));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(screen.getByText("Enter a file path to view blame.")).toBeInTheDocument();
  });
});
