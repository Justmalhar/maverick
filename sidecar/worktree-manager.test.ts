import { describe, test, expect } from "bun:test";
import { WorktreeManager } from "./worktree-manager";
import type { Shell } from "./types";

function fakeShell(transcript: Array<{ stdout?: string; exitCode?: number }> = []): {
  shell: Shell;
  calls: string[][];
} {
  const calls: string[][] = [];
  let i = 0;
  const shell: Shell = {
    async text(cmd) {
      calls.push(cmd);
      const next = transcript[i++] ?? {};
      return next.stdout ?? "";
    },
    async run(cmd) {
      calls.push(cmd);
      const next = transcript[i++] ?? {};
      return { stdout: next.stdout ?? "", stderr: "", exitCode: next.exitCode ?? 0 };
    },
  };
  return { shell, calls };
}

describe("WorktreeManager", () => {
  test("create runs git worktree add and returns ids", async () => {
    const { shell, calls } = fakeShell([{}]);
    const mgr = new WorktreeManager({
      shell,
      ids: { uuid: (p) => `${p}_42`, now: () => 0 },
      base: ".mv/worktrees",
    });
    const r = await mgr.create({ projectPath: "/repo", branch: "feat", baseBranch: "main" });
    expect(r.workspaceId).toBe("ws_42");
    expect(r.worktreePath).toBe(".mv/worktrees/ws_42");
    expect(calls[0]).toEqual([
      "git",
      "worktree",
      "add",
      "-b",
      "feat",
      ".mv/worktrees/ws_42",
      "main",
    ]);
  });

  test("create defaults baseBranch to branch", async () => {
    const { shell, calls } = fakeShell([{}]);
    const mgr = new WorktreeManager({ shell, ids: { uuid: () => "ws_x", now: () => 0 } });
    await mgr.create({ projectPath: "/r", branch: "feat" });
    expect(calls[0][calls[0].length - 1]).toBe("feat");
  });

  test("destroy invokes git worktree remove --force", async () => {
    const { shell, calls } = fakeShell([{}]);
    const mgr = new WorktreeManager({ shell });
    const r = await mgr.destroy({ worktreePath: "/wt" });
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(["git", "worktree", "remove", "--force", "/wt"]);
  });

  test("list parses porcelain output", async () => {
    const { shell } = fakeShell([
      {
        stdout:
          "worktree /a\nHEAD abc\nbranch refs/heads/main\n\nworktree /b\nHEAD def\nbranch refs/heads/feat\n",
      },
    ]);
    const mgr = new WorktreeManager({ shell });
    const list = await mgr.list({ projectPath: "/r" });
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ path: "/a", head: "abc", branch: "refs/heads/main" });
    expect(list[1].path).toBe("/b");
  });

  test("list skips blocks without a worktree path", async () => {
    const { shell } = fakeShell([{ stdout: "\n\nworktree /only\n" }]);
    const mgr = new WorktreeManager({ shell });
    const list = await mgr.list({ projectPath: "/r" });
    expect(list).toHaveLength(1);
  });

  test("prune calls git worktree prune", async () => {
    const { shell, calls } = fakeShell([{}]);
    const mgr = new WorktreeManager({ shell });
    const r = await mgr.prune({ projectPath: "/r" });
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(["git", "worktree", "prune"]);
  });

  test("default constructor builds without DI", () => {
    expect(new WorktreeManager()).toBeInstanceOf(WorktreeManager);
  });
});
