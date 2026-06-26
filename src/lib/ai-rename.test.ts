import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renameWorkspaceBranchWithAI } from "./ai-rename";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("renameWorkspaceBranchWithAI", () => {
  it("names from the diff then renames, returning the new branch", async () => {
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "ai_branch_name_from_diff") return { name: "feature/login-page" };
      if (cmd === "git_rename_branch") return { ok: true, branch: "feature/login-page" };
      return undefined;
    }) as unknown as typeof invoke);
    const branch = await renameWorkspaceBranchWithAI({ worktreePath: "/wt", instructions: "use feature/<name>" });
    expect(branch).toBe("feature/login-page");
    expect(invoke).toHaveBeenCalledWith("ai_branch_name_from_diff", { cwd: "/wt", instructions: "use feature/<name>" });
    expect(invoke).toHaveBeenCalledWith("git_rename_branch", { worktreePath: "/wt", newBranch: "feature/login-page" });
  });

  it("returns null (no rename) when the AI yields an empty name", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ name: "" } as never);
    const branch = await renameWorkspaceBranchWithAI({ worktreePath: "/wt" });
    expect(branch).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("git_rename_branch", expect.anything());
  });

  it("returns null when a step throws (never blocks the caller)", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("claude down"));
    expect(await renameWorkspaceBranchWithAI({ worktreePath: "/wt" })).toBeNull();
  });
});
