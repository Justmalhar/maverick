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
