import { describe, test, expect } from "bun:test";
import { GitModule } from "./git-module";
import type { Shell } from "./types";

interface Step {
  stdout?: string;
  exitCode?: number;
  stderr?: string;
}

function transcript(steps: Step[]): { shell: Shell; calls: string[][] } {
  const calls: string[][] = [];
  let i = 0;
  const shell: Shell = {
    async text(cmd) {
      calls.push(cmd);
      return steps[i++]?.stdout ?? "";
    },
    async run(cmd) {
      calls.push(cmd);
      const s = steps[i++] ?? {};
      return { stdout: s.stdout ?? "", stderr: s.stderr ?? "", exitCode: s.exitCode ?? 0 };
    },
  };
  return { shell, calls };
}

describe("GitModule.parseLog", () => {
  test("parses one commit with stats", () => {
    const out = `abc\tAlice\t1700000000\tinitial\n 2 files changed, 5 insertions(+)\n\n`;
    const commits = GitModule.parseLog(out);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({
      sha: "abc",
      author: "Alice",
      timestamp: 1700000000,
      message: "initial",
      fileCount: 2,
    });
  });

  test("parses commit without shortstat", () => {
    const out = `abc\tAlice\t1700000000\thi\n\n`;
    const commits = GitModule.parseLog(out);
    expect(commits[0].fileCount).toBe(0);
  });

  test("skips malformed lines", () => {
    const commits = GitModule.parseLog("");
    expect(commits).toEqual([]);
  });

  test("ignores lines missing tabs", () => {
    const out = `nope\nabc\tAlice\t1\tm\n`;
    expect(GitModule.parseLog(out)).toHaveLength(1);
  });
});

describe("GitModule.parseStashList", () => {
  test("parses entries", () => {
    const out = `stash@{0}\t1700000000\tWIP on main: abc fix\nstash@{1}\t1700000100\tOn feat: stuff`;
    const stashes = GitModule.parseStashList(out);
    expect(stashes).toHaveLength(2);
    expect(stashes[1].branch).toBe("feat");
  });

  test("returns empty array on empty input", () => {
    expect(GitModule.parseStashList("")).toEqual([]);
  });

  test("handles entry without branch info", () => {
    const stashes = GitModule.parseStashList("stash@{0}\t1\tno-branch-here");
    expect(stashes[0].branch).toBe("");
  });
});

describe("GitModule methods", () => {
  test("log calls git log and parses", async () => {
    const { shell, calls } = transcript([{ stdout: "abc\tA\t1\tm\n" }]);
    const commits = await new GitModule({ shell }).log({ worktreePath: "/w", limit: 5 });
    expect(commits[0].sha).toBe("abc");
    expect(calls[0]).toContain("--max-count=5");
  });

  test("stashList delegates to parser", async () => {
    const { shell } = transcript([{ stdout: "stash@{0}\t1\tOn main: x" }]);
    const stashes = await new GitModule({ shell }).stashList({ worktreePath: "/w" });
    expect(stashes).toHaveLength(1);
  });

  test("commit stages files and returns sha", async () => {
    const { shell, calls } = transcript([
      {}, // add
      {}, // commit
      { stdout: "deadbeef\n" }, // rev-parse
    ]);
    const r = await new GitModule({ shell }).commit({
      worktreePath: "/w",
      message: "msg",
      files: ["a.ts"],
    });
    expect(r.sha).toBe("deadbeef");
    expect(calls[0]).toContain("add");
  });

  test("commit skips add when no files", async () => {
    const { shell, calls } = transcript([{}, { stdout: "sha\n" }]);
    await new GitModule({ shell }).commit({ worktreePath: "/w", message: "m" });
    expect(calls[0]).toContain("commit");
  });

  test("commit throws on commit failure", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "nothing to commit" }]);
    await expect(
      new GitModule({ shell }).commit({ worktreePath: "/w", message: "m" })
    ).rejects.toThrow(/nothing to commit/);
  });

  test("push runs git push with optional remote/branch", async () => {
    const { shell, calls } = transcript([{}]);
    await new GitModule({ shell }).push({ worktreePath: "/w", remote: "origin", branch: "main" });
    expect(calls[0]).toEqual(["git", "-C", "/w", "push", "origin", "main"]);
  });

  test("push throws on failure", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "rejected" }]);
    await expect(new GitModule({ shell }).push({ worktreePath: "/w" })).rejects.toThrow(/rejected/);
  });

  test("pull runs git pull", async () => {
    const { shell, calls } = transcript([{}]);
    await new GitModule({ shell }).pull({ worktreePath: "/w" });
    expect(calls[0]).toEqual(["git", "-C", "/w", "pull"]);
  });

  test("pull throws on failure", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "conflict" }]);
    await expect(new GitModule({ shell }).pull({ worktreePath: "/w" })).rejects.toThrow(/conflict/);
  });

  test("fetch supports optional remote", async () => {
    const { shell, calls } = transcript([{}]);
    await new GitModule({ shell }).fetch({ worktreePath: "/w", remote: "origin" });
    expect(calls[0]).toContain("origin");
  });

  test("fetch throws on failure", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "no network" }]);
    await expect(new GitModule({ shell }).fetch({ worktreePath: "/w" })).rejects.toThrow();
  });

  test("branchList parses output", async () => {
    const { shell } = transcript([{ stdout: "main\nfeat\n" }]);
    const list = await new GitModule({ shell }).branchList({ worktreePath: "/w" });
    expect(list).toEqual(["main", "feat"]);
  });

  test("branchCreate runs git branch", async () => {
    const { shell, calls } = transcript([{}]);
    await new GitModule({ shell }).branchCreate({ worktreePath: "/w", name: "x" });
    expect(calls[0]).toContain("x");
  });

  test("branchCreate throws on failure", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "exists" }]);
    await expect(
      new GitModule({ shell }).branchCreate({ worktreePath: "/w", name: "x" })
    ).rejects.toThrow();
  });

  test("branchDelete runs git branch -D", async () => {
    const { shell, calls } = transcript([{}]);
    await new GitModule({ shell }).branchDelete({ worktreePath: "/w", name: "x" });
    expect(calls[0]).toContain("-D");
  });

  test("branchDelete throws on failure", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "not found" }]);
    await expect(
      new GitModule({ shell }).branchDelete({ worktreePath: "/w", name: "x" })
    ).rejects.toThrow();
  });

  test("checkout runs git checkout", async () => {
    const { shell, calls } = transcript([{}]);
    await new GitModule({ shell }).checkout({ worktreePath: "/w", ref: "abc" });
    expect(calls[0]).toContain("abc");
  });

  test("checkout throws on failure", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "dirty" }]);
    await expect(
      new GitModule({ shell }).checkout({ worktreePath: "/w", ref: "x" })
    ).rejects.toThrow();
  });

  test("cherryPick runs git cherry-pick", async () => {
    const { shell, calls } = transcript([{}]);
    await new GitModule({ shell }).cherryPick({ worktreePath: "/w", sha: "abc" });
    expect(calls[0]).toContain("cherry-pick");
  });

  test("cherryPick throws on failure", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "conflict" }]);
    await expect(
      new GitModule({ shell }).cherryPick({ worktreePath: "/w", sha: "x" })
    ).rejects.toThrow();
  });

  test("default constructor builds without DI", () => {
    expect(new GitModule()).toBeInstanceOf(GitModule);
  });
});

describe("GitModule.parseWorktreePaths", () => {
  test("extracts worktree paths, skips non-worktree lines", () => {
    const output = [
      "worktree /home/user/project",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /home/user/project/.maverick/worktrees/ws-1",
      "HEAD def456",
      "branch refs/heads/feat/foo",
    ].join("\n");
    expect(GitModule.parseWorktreePaths(output)).toEqual([
      "/home/user/project",
      "/home/user/project/.maverick/worktrees/ws-1",
    ]);
  });

  test("returns empty array for empty output", () => {
    expect(GitModule.parseWorktreePaths("")).toEqual([]);
  });
});

describe("GitModule.parseDiffStat", () => {
  test("parses insertions and deletions", () => {
    expect(
      GitModule.parseDiffStat(" 3 files changed, 10 insertions(+), 4 deletions(-)")
    ).toEqual({ added: 10, removed: 4 });
  });

  test("returns zeros when no changes", () => {
    expect(GitModule.parseDiffStat("")).toEqual({ added: 0, removed: 0 });
  });

  test("handles insertions-only", () => {
    expect(GitModule.parseDiffStat(" 1 file changed, 5 insertions(+)")).toEqual({
      added: 5,
      removed: 0,
    });
  });
});

describe("GitModule.branches", () => {
  test("returns local branches + worktree entries, skips main worktree", async () => {
    const { shell } = transcript([
      { stdout: "main\nfeat/foo\n" },
      {
        stdout: [
          "worktree /home/user/project",
          "",
          "worktree /home/user/project/.maverick/worktrees/ws-1",
          "",
        ].join("\n"),
      },
    ]);
    const git = new GitModule({ shell });
    const result = await git.branches({ projectPath: "/home/user/project" });
    expect(result).toEqual([
      "main",
      "feat/foo",
      "worktree//home/user/project/.maverick/worktrees/ws-1",
    ]);
  });

  test("returns only local branches when worktree list fails", async () => {
    const calls: string[][] = [];
    const shell: Shell = {
      async text(cmd) {
        calls.push(cmd);
        if (cmd.includes("worktree")) throw new Error("no worktrees");
        return "main\n";
      },
      async run(cmd) {
        calls.push(cmd);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    const git = new GitModule({ shell });
    const result = await git.branches({ projectPath: "/p" });
    expect(result).toEqual(["main"]);
  });
});

describe("GitModule.diffStat", () => {
  test("returns parsed diff stat", async () => {
    const { shell } = transcript([
      { stdout: " 2 files changed, 7 insertions(+), 1 deletion(-)" },
    ]);
    const git = new GitModule({ shell });
    const stat = await git.diffStat({ worktreePath: "/wt" });
    expect(stat).toEqual({ added: 7, removed: 1 });
  });

  test("returns zeros on shell error", async () => {
    const shell: Shell = {
      async text() {
        throw new Error("not a git repo");
      },
      async run() {
        return { stdout: "", stderr: "", exitCode: 1 };
      },
    };
    const git = new GitModule({ shell });
    const stat = await git.diffStat({ worktreePath: "/bad" });
    expect(stat).toEqual({ added: 0, removed: 0 });
  });
});
