import { describe, test, expect } from "bun:test";
import { GitModule, GitError } from "./git-module";
import type { Shell } from "./types";

interface Step {
  stdout?: string;
  exitCode?: number;
  stderr?: string;
}

function bytes(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
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

  test("prCreate pushes the branch then runs gh pr create --fill", async () => {
    const { shell, calls } = transcript([
      { stdout: "feature-x\n" }, // rev-parse --abbrev-ref HEAD
      {}, // git push -u origin feature-x
      { stdout: "https://github.com/o/r/pull/3\n" }, // gh pr create
    ]);
    const result = await new GitModule({ shell }).prCreate({ worktreePath: "/w" });
    expect(calls[0]).toEqual(["git", "-C", "/w", "rev-parse", "--abbrev-ref", "HEAD"]);
    expect(calls[1]).toEqual(["git", "-C", "/w", "push", "-u", "origin", "feature-x"]);
    expect(calls[2]).toEqual(["gh", "pr", "create", "--head", "feature-x", "--fill"]);
    expect(result.url).toBe("https://github.com/o/r/pull/3");
  });

  test("prCreate passes title/body/base when provided", async () => {
    const { shell, calls } = transcript([
      { stdout: "feature-y\n" },
      {},
      { stdout: "https://github.com/o/r/pull/4\n" },
    ]);
    await new GitModule({ shell }).prCreate({
      worktreePath: "/w",
      title: "My PR",
      body: "Details",
      base: "develop",
    });
    expect(calls[2]).toEqual([
      "gh", "pr", "create", "--head", "feature-y",
      "--base", "develop", "--title", "My PR", "--body", "Details",
    ]);
  });

  test("prCreate throws when the push fails", async () => {
    const { shell } = transcript([
      { stdout: "feature-z\n" },
      { exitCode: 1, stderr: "push rejected" },
    ]);
    await expect(new GitModule({ shell }).prCreate({ worktreePath: "/w" })).rejects.toThrow(/push rejected/);
  });

  test("prCreate throws when gh fails", async () => {
    const { shell } = transcript([
      { stdout: "feature-q\n" },
      {},
      { exitCode: 1, stderr: "gh: not authenticated" },
    ]);
    await expect(new GitModule({ shell }).prCreate({ worktreePath: "/w" })).rejects.toThrow(/not authenticated/);
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

  test("branchList parses rich branches via for-each-ref", async () => {
    const { shell, calls } = transcript([
      {
        stdout: [
          "*\trefs/heads/main\torigin/main\tahead 2, behind 1",
          " \trefs/heads/feat\t\t",
          " \trefs/remotes/origin/main\t\t",
          " \trefs/remotes/origin/HEAD\t\t",
        ].join("\n"),
      },
    ]);
    const list = await new GitModule({ shell }).branchList({ worktreePath: "/w" });
    expect(calls[0]).toContain("for-each-ref");
    // origin/HEAD alias is dropped.
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({
      name: "main",
      isRemote: false,
      isCurrent: true,
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
    expect(list[1]).toEqual({ name: "feat", isRemote: false, isCurrent: false });
    expect(list[2]).toEqual({ name: "origin/main", isRemote: true, isCurrent: false });
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

  test("checkoutBranch checks out a local branch by name", async () => {
    const { shell, calls } = transcript([{}]);
    await new GitModule({ shell }).checkoutBranch({ worktreePath: "/w", branch: "feat" });
    expect(calls[0]).toEqual(["git", "-C", "/w", "checkout", "feat"]);
  });

  test("checkoutBranch strips remotes/ prefix so git auto-tracks", async () => {
    const { shell, calls } = transcript([{}]);
    await new GitModule({ shell }).checkoutBranch({
      worktreePath: "/w",
      branch: "remotes/origin/feat",
    });
    expect(calls[0]).toEqual(["git", "-C", "/w", "checkout", "origin/feat"]);
  });

  test("checkoutBranch throws on failure", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "would be overwritten" }]);
    await expect(
      new GitModule({ shell }).checkoutBranch({ worktreePath: "/w", branch: "x" })
    ).rejects.toThrow(/overwritten/);
  });

  test("blame delegates to git blame --line-porcelain and parses", async () => {
    const { shell, calls } = transcript([
      {
        stdout: [
          "abc1234 1 1 1",
          "author Alice",
          "author-time 1700000000",
          "\tconst x = 1;",
        ].join("\n"),
      },
    ]);
    const lines = await new GitModule({ shell }).blame({ worktreePath: "/w", filePath: "a.ts" });
    expect(calls[0]).toEqual(["git", "-C", "/w", "blame", "--line-porcelain", "--", "a.ts"]);
    expect(lines[0]).toEqual({
      sha: "abc1234",
      author: "Alice",
      timestamp: 1700000000,
      lineNumber: 1,
      content: "const x = 1;",
    });
  });

  test("stashApply/Pop/Drop target the indexed stash ref", async () => {
    const { shell, calls } = transcript([{}, {}, {}]);
    const git = new GitModule({ shell });
    await git.stashApply({ worktreePath: "/w", index: 0 });
    await git.stashPop({ worktreePath: "/w", index: 1 });
    await git.stashDrop({ worktreePath: "/w", index: 2 });
    expect(calls[0]).toEqual(["git", "-C", "/w", "stash", "apply", "stash@{0}"]);
    expect(calls[1]).toEqual(["git", "-C", "/w", "stash", "pop", "stash@{1}"]);
    expect(calls[2]).toEqual(["git", "-C", "/w", "stash", "drop", "stash@{2}"]);
  });

  test("stashApply throws a typed GitError via classifyError", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "no stash entries" }]);
    let caught: unknown;
    try {
      await new GitModule({ shell }).stashApply({ worktreePath: "/w", index: 0 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitError);
    expect((caught as GitError).kind).toBe("failed");
    expect((caught as GitError).message).toMatch(/no stash entries/);
  });

  test("stashPop classifies an auth failure from stderr", async () => {
    const { shell } = transcript([
      { exitCode: 1, stderr: "fatal: Authentication failed for 'https://x'" },
    ]);
    let caught: unknown;
    try {
      await new GitModule({ shell }).stashPop({ worktreePath: "/w", index: 0 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitError);
    expect((caught as GitError).kind).toBe("auth");
  });

  test("conflicts lists unmerged files and parses their markers", async () => {
    const conflicted = [
      "ok line",
      "<<<<<<< HEAD",
      "ours line",
      "=======",
      "theirs line",
      ">>>>>>> feat",
    ].join("\n");
    const { shell, calls } = transcript([
      { stdout: "file.ts\n" }, // diff --name-only --diff-filter=U
      { stdout: "base line" }, // git show :1:file.ts
    ]);
    const readFile = async (path: string) => {
      expect(path).toBe("/w/file.ts");
      return bytes(conflicted);
    };
    const hunks = await new GitModule({ shell, readFile }).conflicts({ worktreePath: "/w" });
    expect(calls[0]).toContain("--diff-filter=U");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].filePath).toBe("file.ts");
    expect(hunks[0].ours).toEqual(["ours line"]);
    expect(hunks[0].theirs).toEqual(["theirs line"]);
    expect(hunks[0].base).toEqual(["base line"]);
    expect(hunks[0].binary).toBeUndefined();
  });

  test("conflicts returns empty when working tree is clean", async () => {
    const { shell } = transcript([{ stdout: "\n" }]);
    const hunks = await new GitModule({ shell }).conflicts({ worktreePath: "/w" });
    expect(hunks).toEqual([]);
  });

  test("conflicts tolerates a failing git show but still reads the working tree", async () => {
    const conflicted = ["<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> feat"].join("\n");
    const shell: Shell = {
      async text(cmd) {
        if (cmd.includes("--diff-filter=U")) return "file.ts\n";
        throw new Error("boom"); // git show :1: fails (no base stage)
      },
      async run() {
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    const hunks = await new GitModule({
      shell,
      readFile: async () => bytes(conflicted),
    }).conflicts({ worktreePath: "/w" });
    expect(hunks).toHaveLength(1);
    expect(hunks[0].ours).toEqual(["ours"]);
    expect(hunks[0].base).toBeUndefined();
  });

  test("conflicts flags a binary conflict file instead of dropping it", async () => {
    const { shell } = transcript([
      { stdout: "image.png\n" }, // diff --name-only --diff-filter=U
      { stdout: "" }, // git show :1:image.png
    ]);
    const binaryReader = async () => new Uint8Array([0x89, 0x50, 0x00, 0x4e]).buffer;
    const hunks = await new GitModule({ shell, readFile: binaryReader }).conflicts({
      worktreePath: "/w",
    });
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toEqual({ filePath: "image.png", hunkIndex: 0, ours: [], theirs: [], binary: true });
  });

  test("conflicts flags an unreadable conflict file as binary rather than swallowing", async () => {
    const { shell } = transcript([
      { stdout: "gone.ts\n" }, // diff --name-only --diff-filter=U
      { stdout: "" }, // git show :1:gone.ts
    ]);
    const failingReader = async () => {
      throw new Error("ENOENT");
    };
    const hunks = await new GitModule({ shell, readFile: failingReader }).conflicts({
      worktreePath: "/w",
    });
    expect(hunks).toHaveLength(1);
    expect(hunks[0].binary).toBe(true);
    expect(hunks[0].filePath).toBe("gone.ts");
  });

  test("resolveConflict ours checks out --ours and stages the file", async () => {
    const { shell, calls } = transcript([{}, {}]);
    await new GitModule({ shell }).resolveConflict({
      worktreePath: "/w",
      filePath: "f.ts",
      hunkIndex: 0,
      resolution: "ours",
    });
    expect(calls[0]).toEqual(["git", "-C", "/w", "checkout", "--ours", "--", "f.ts"]);
    expect(calls[1]).toEqual(["git", "-C", "/w", "add", "--", "f.ts"]);
  });

  test("resolveConflict theirs checks out --theirs", async () => {
    const { shell, calls } = transcript([{}, {}]);
    await new GitModule({ shell }).resolveConflict({
      worktreePath: "/w",
      filePath: "f.ts",
      hunkIndex: 0,
      resolution: "theirs",
    });
    expect(calls[0]).toContain("--theirs");
  });

  test("resolveConflict both stages the working-tree file without checkout", async () => {
    const { shell, calls } = transcript([{}]);
    await new GitModule({ shell }).resolveConflict({
      worktreePath: "/w",
      filePath: "f.ts",
      hunkIndex: 0,
      resolution: "both",
    });
    // No `git checkout` (there is no valid --merge file flag); only stage as-is.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["git", "-C", "/w", "add", "--", "f.ts"]);
    expect(calls[0]).not.toContain("checkout");
    expect(calls[0]).not.toContain("--merge");
  });

  test("resolveConflict both throws when staging fails", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "add failed (both)" }]);
    await expect(
      new GitModule({ shell }).resolveConflict({
        worktreePath: "/w",
        filePath: "f.ts",
        hunkIndex: 0,
        resolution: "both",
      })
    ).rejects.toThrow(/add failed \(both\)/);
  });

  test("resolveConflict throws when checkout fails", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "pathspec error" }]);
    await expect(
      new GitModule({ shell }).resolveConflict({
        worktreePath: "/w",
        filePath: "f.ts",
        hunkIndex: 0,
        resolution: "ours",
      })
    ).rejects.toThrow(/pathspec error/);
  });

  test("resolveConflict throws when staging fails", async () => {
    const { shell } = transcript([{}, { exitCode: 1, stderr: "add failed" }]);
    await expect(
      new GitModule({ shell }).resolveConflict({
        worktreePath: "/w",
        filePath: "f.ts",
        hunkIndex: 0,
        resolution: "ours",
      })
    ).rejects.toThrow(/add failed/);
  });

  test("push surfaces a typed auth error from stderr", async () => {
    const { shell } = transcript([
      { exitCode: 128, stderr: "fatal: Authentication failed for 'https://github.com/o/r'" },
    ]);
    await expect(
      new GitModule({ shell }).push({ worktreePath: "/w" })
    ).rejects.toThrow(/authentication required/i);
  });

  test("push surfaces a typed no-upstream error", async () => {
    const { shell } = transcript([
      { exitCode: 128, stderr: "fatal: The current branch feat has no upstream branch." },
    ]);
    const err = await new GitModule({ shell })
      .push({ worktreePath: "/w" })
      .catch((e: GitError) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as GitError).kind).toBe("no_upstream");
  });

  test("pull classifies host key verification as auth", async () => {
    const { shell } = transcript([
      { exitCode: 128, stderr: "Host key verification failed." },
    ]);
    const err = await new GitModule({ shell })
      .pull({ worktreePath: "/w" })
      .catch((e: GitError) => e);
    expect((err as GitError).kind).toBe("auth");
  });

  test("fetch failure with generic stderr yields kind=failed", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "could not resolve host" }]);
    const err = await new GitModule({ shell })
      .fetch({ worktreePath: "/w" })
      .catch((e: GitError) => e);
    expect((err as GitError).kind).toBe("failed");
    expect((err as GitError).message).toContain("could not resolve host");
  });

  test("default constructor builds without DI", () => {
    expect(new GitModule()).toBeInstanceOf(GitModule);
  });
});

describe("GitModule.classifyError", () => {
  test("maps each auth signature to kind=auth", () => {
    const signatures = [
      "could not read Username for 'https://...'",
      "could not read Password",
      "Authentication failed",
      "Permission denied (publickey).",
      "Invalid credentials",
      "Host key verification failed.",
      "terminal prompts disabled",
    ];
    for (const s of signatures) {
      expect(GitModule.classifyError(s, "git push").kind).toBe("auth");
    }
  });

  test("maps no-upstream variants to kind=no_upstream", () => {
    expect(GitModule.classifyError("has no upstream branch", "git push").kind).toBe("no_upstream");
    expect(
      GitModule.classifyError("no configured push destination", "git push").kind
    ).toBe("no_upstream");
  });

  test("falls back to context label when stderr is empty", () => {
    const e = GitModule.classifyError("", "git push");
    expect(e.kind).toBe("failed");
    expect(e.message).toBe("git push failed");
  });
});

describe("GitModule.parseBranches", () => {
  test("returns empty array on empty input", () => {
    expect(GitModule.parseBranches("")).toEqual([]);
  });

  test("skips lines without tabs", () => {
    expect(GitModule.parseBranches("garbage-no-tabs\n")).toEqual([]);
  });

  test("parses ahead-only and behind-only tracking", () => {
    const out = [
      " \trefs/heads/a\torigin/a\tahead 3",
      " \trefs/heads/b\torigin/b\tbehind 4",
    ].join("\n");
    const parsed = GitModule.parseBranches(out);
    expect(parsed[0].ahead).toBe(3);
    expect(parsed[0].behind).toBeUndefined();
    expect(parsed[1].behind).toBe(4);
    expect(parsed[1].ahead).toBeUndefined();
  });
});

describe("GitModule.parseBlame", () => {
  test("returns empty array on empty input", () => {
    expect(GitModule.parseBlame("")).toEqual([]);
  });

  test("parses multiple lines and skips non-header noise", () => {
    const out = [
      "deadbeef 1 1 2",
      "author Bob",
      "author-time 1600000000",
      "summary first",
      "\tfirst line",
      "deadbeef 2 2",
      "\tsecond line",
    ].join("\n");
    const lines = GitModule.parseBlame(out);
    expect(lines).toHaveLength(2);
    expect(lines[0].author).toBe("Bob");
    expect(lines[1].lineNumber).toBe(2);
    expect(lines[1].author).toBe(""); // header-without-author repeat block
  });
});

describe("GitModule.parseConflictMarkers", () => {
  test("returns empty when there are no markers", () => {
    expect(GitModule.parseConflictMarkers("f.ts", "plain\ncontent", "")).toEqual([]);
  });

  test("parses diff3-style base block", () => {
    const content = [
      "<<<<<<< HEAD",
      "ours",
      "||||||| base",
      "common",
      "=======",
      "theirs",
      ">>>>>>> branch",
    ].join("\n");
    const hunks = GitModule.parseConflictMarkers("f.ts", content, "ignored-fallback");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].ours).toEqual(["ours"]);
    expect(hunks[0].theirs).toEqual(["theirs"]);
    expect(hunks[0].base).toEqual(["common"]);
  });

  test("parses two hunks and increments hunkIndex", () => {
    const content = [
      "<<<<<<< HEAD",
      "a1",
      "=======",
      "b1",
      ">>>>>>> x",
      "context",
      "<<<<<<< HEAD",
      "a2",
      "=======",
      "b2",
      ">>>>>>> y",
    ].join("\n");
    const hunks = GitModule.parseConflictMarkers("f.ts", content, "");
    expect(hunks).toHaveLength(2);
    expect(hunks[0].hunkIndex).toBe(0);
    expect(hunks[1].hunkIndex).toBe(1);
    expect(hunks[1].ours).toEqual(["a2"]);
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
