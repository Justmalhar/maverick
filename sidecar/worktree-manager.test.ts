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
    // Path is anchored at projectPath so it is absolute and cwd-independent.
    expect(r.worktreePath).toBe("/repo/.mv/worktrees/ws_42");
    expect(calls[0]).toEqual([
      "git",
      "worktree",
      "add",
      "-b",
      "feat",
      "/repo/.mv/worktrees/ws_42",
      "main",
    ]);
  });

  test("create defaults baseBranch to branch", async () => {
    const { shell, calls } = fakeShell([{}]);
    const mgr = new WorktreeManager({ shell, ids: { uuid: () => "ws_x", now: () => 0 } });
    await mgr.create({ projectPath: "/r", branch: "feat" });
    expect(calls[0][calls[0].length - 1]).toBe("feat");
  });

  test("create with an absolute base does not double-anchor at projectPath", async () => {
    const { shell, calls } = fakeShell([{}]);
    const mgr = new WorktreeManager({
      shell,
      ids: { uuid: () => "ws_abs", now: () => 0 },
      base: "/abs/worktrees",
    });
    const r = await mgr.create({ projectPath: "/repo", branch: "feat" });
    expect(r.worktreePath).toBe("/abs/worktrees/ws_abs");
    expect(calls[0][5]).toBe("/abs/worktrees/ws_abs");
  });

  test("destroy invokes git worktree remove --force with the project root as cwd", async () => {
    const { shell, calls } = fakeShell([{}]);
    const mgr = new WorktreeManager({ shell, base: ".mv/worktrees" });
    const r = await mgr.destroy({ worktreePath: "/repo/.mv/worktrees/ws", projectPath: "/repo" });
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual([
      "git",
      "worktree",
      "remove",
      "--force",
      "/repo/.mv/worktrees/ws",
    ]);
  });

  test("create and destroy resolve the same worktree path symmetrically", async () => {
    const { shell, calls } = fakeShell([{}, {}]);
    const mgr = new WorktreeManager({
      shell,
      ids: { uuid: () => "ws_sym", now: () => 0 },
      base: ".mv/worktrees",
    });
    const { worktreePath } = await mgr.create({ projectPath: "/proj", branch: "feat" });
    await mgr.destroy({ worktreePath, projectPath: "/proj" });
    // create's `git worktree add <path>` and destroy's `git worktree remove <path>`
    // must reference the identical absolute path.
    expect(calls[0][5]).toBe(worktreePath);
    expect(calls[1][4]).toBe(worktreePath);
  });

  test("destroy falls back to prune when remove fails", async () => {
    const { shell, calls } = fakeShell([{ exitCode: 1 }, { exitCode: 0 }]);
    const mgr = new WorktreeManager({ shell });
    const r = await mgr.destroy({ worktreePath: "/wt", projectPath: "/repo" });
    expect(r.ok).toBe(true);
    expect(calls[0][1]).toBe("worktree");
    expect(calls[0][2]).toBe("remove");
    expect(calls[1]).toEqual(["git", "worktree", "prune"]);
  });

  test("destroy throws when both remove and prune fail", async () => {
    const { shell } = fakeShell([
      { exitCode: 1, stderr: "remove boom" },
      { exitCode: 2, stderr: "prune boom" },
    ]);
    const mgr = new WorktreeManager({ shell });
    await expect(mgr.destroy({ worktreePath: "/wt", projectPath: "/repo" })).rejects.toThrow(
      /remove failed.*prune failed/
    );
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

  test("copy resolves dst against the real worktree path, not the sidecar cwd", async () => {
    const srcProject = mkdtempSync(join(tmpdir(), "mvk-src-"));
    const worktree = mkdtempSync(join(tmpdir(), "mvk-wt-"));
    writeFileSync(join(srcProject, ".env"), "TOKEN=hi");
    const { shell } = fakeShell();
    const mgr = new WorktreeManager({ shell });
    // Call copy directly with an absolute, out-of-cwd worktree path: the file
    // must land inside that worktree regardless of process.cwd().
    mgr.copy(srcProject, worktree, [".env"]);
    expect(existsSync(join(worktree, ".env"))).toBe(true);
    expect(readFileSync(join(worktree, ".env"), "utf8")).toBe("TOKEN=hi");
  });

  test("copy refuses a filesToCopy entry that escapes the worktree", async () => {
    const srcProject = mkdtempSync(join(tmpdir(), "mvk-src-"));
    const worktree = mkdtempSync(join(tmpdir(), "mvk-wt-"));
    const escapeTarget = mkdtempSync(join(tmpdir(), "mvk-escape-"));
    writeFileSync(join(srcProject, "secret"), "leak");
    const { shell } = fakeShell();
    const mgr = new WorktreeManager({ shell });
    // A traversal entry whose dst would land outside the worktree must be skipped.
    mgr.copy(srcProject, worktree, [`../${escapeTarget.split("/").pop()}/pwned`]);
    expect(existsSync(join(escapeTarget, "pwned"))).toBe(false);
  });

  test("create refuses a workspace path that escapes the workspaces root", async () => {
    const { shell } = fakeShell();
    // A base of "" anchors the root at projectPath; a poisoned id with traversal
    // resolves above the root and must be rejected before any git call.
    const mgr = new WorktreeManager({
      shell,
      ids: { uuid: () => "../../escape", now: () => 0 },
      base: "wt",
    });
    await expect(mgr.create({ projectPath: "/repo", branch: "feat" })).rejects.toThrow(
      /escapes workspaces root/
    );
  });
});
