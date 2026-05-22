import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { WorktreeManager } from "./worktree-manager";
import type { Shell } from "./types";

function fakeShellThatCreatesWorktreeDir(): { shell: Shell; calls: string[][] } {
  const calls: string[][] = [];
  const shell: Shell = {
    async text(cmd) {
      calls.push(cmd);
      return "";
    },
    async run(cmd) {
      calls.push(cmd);
      if (cmd[0] === "git" && cmd[1] === "worktree" && cmd[2] === "add") {
        const path = cmd[cmd.length - 2];
        mkdirSync(path, { recursive: true });
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
  return { shell, calls };
}

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

  test("copies filesToCopy from project root into the new worktree", async () => {
    const srcProject = mkdtempSync(join(tmpdir(), "mvk-src-"));
    const base = mkdtempSync(join(tmpdir(), "mvk-base-"));
    writeFileSync(join(srcProject, ".env"), "TOKEN=hi");
    const { shell } = fakeShellThatCreatesWorktreeDir();
    const mgr = new WorktreeManager({
      shell,
      ids: { uuid: () => "ws_copy", now: () => 0 },
      base,
    });
    const { worktreePath } = await mgr.create({
      projectPath: srcProject,
      branch: "feat/copy",
      filesToCopy: [".env"],
    });
    expect(existsSync(join(worktreePath, ".env"))).toBe(true);
    expect(readFileSync(join(worktreePath, ".env"), "utf8")).toBe("TOKEN=hi");
  });

  test("skip-if-source-missing for filesToCopy", async () => {
    const srcProject = mkdtempSync(join(tmpdir(), "mvk-src-"));
    const base = mkdtempSync(join(tmpdir(), "mvk-base-"));
    const { shell } = fakeShellThatCreatesWorktreeDir();
    const mgr = new WorktreeManager({
      shell,
      ids: { uuid: () => "ws_miss", now: () => 0 },
      base,
    });
    const { worktreePath } = await mgr.create({
      projectPath: srcProject,
      branch: "feat/missing",
      filesToCopy: [".does-not-exist"],
    });
    expect(existsSync(worktreePath)).toBe(true);
    expect(existsSync(join(worktreePath, ".does-not-exist"))).toBe(false);
  });
});
