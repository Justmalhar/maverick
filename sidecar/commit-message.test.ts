import { describe, test, expect } from "bun:test";
import { CommitMessageGenerator } from "./commit-message";
import type { Shell } from "./types";

interface Step {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

function transcript(steps: Step[]): { shell: Shell; calls: string[][]; stdins: Array<string | undefined> } {
  const calls: string[][] = [];
  const stdins: Array<string | undefined> = [];
  let i = 0;
  return {
    calls,
    stdins,
    shell: {
      async text(cmd) {
        calls.push(cmd);
        stdins.push(undefined);
        return steps[i++]?.stdout ?? "";
      },
      async run(cmd, _cwd, stdin) {
        calls.push(cmd);
        stdins.push(stdin);
        const s = steps[i++] ?? {};
        return { stdout: s.stdout ?? "", stderr: s.stderr ?? "", exitCode: s.exitCode ?? 0 };
      },
    },
  };
}

describe("CommitMessageGenerator", () => {
  test("feeds stat + diff to claude -p over stdin and returns the trimmed message", async () => {
    const { shell, calls, stdins } = transcript([
      { stdout: " src/a.ts | 2 +-\n 1 file changed\n" }, // diff --stat
      { stdout: "diff --git a/src/a.ts b/src/a.ts\n+new line\n" }, // diff
      { stdout: "feat(a): add new line\n" }, // claude
    ]);
    const r = await new CommitMessageGenerator({ shell }).generate({ worktreePath: "/w" });
    expect(calls[0]).toEqual(["git", "-C", "/w", "diff", "HEAD", "--stat"]);
    expect(calls[1]).toEqual(["git", "-C", "/w", "diff", "HEAD"]);
    expect(calls[2]).toEqual(["claude", "-p", "--output-format", "text"]);
    expect(stdins[2]).toContain("conventional commit message");
    expect(stdins[2]).toContain("src/a.ts | 2 +-");
    expect(stdins[2]).toContain("+new line");
    expect(r.message).toBe("feat(a): add new line");
  });

  test("truncates oversized diffs in the prompt", async () => {
    const huge = "x".repeat(50_000);
    const { shell, stdins } = transcript([
      { stdout: " big | 1 +\n" },
      { stdout: huge },
      { stdout: "chore: big\n" },
    ]);
    await new CommitMessageGenerator({ shell }).generate({ worktreePath: "/w" });
    expect(stdins[2]!.length).toBeLessThan(10_000);
  });

  test("throws when there are no changes", async () => {
    const { shell } = transcript([{ stdout: "  \n" }]);
    await expect(
      new CommitMessageGenerator({ shell }).generate({ worktreePath: "/w" })
    ).rejects.toThrow(/no changes/);
  });

  test("throws with stderr when the claude CLI fails", async () => {
    const { shell } = transcript([
      { stdout: " a | 1 +\n" },
      { stdout: "diff\n" },
      { exitCode: 1, stderr: "not logged in" },
    ]);
    await expect(
      new CommitMessageGenerator({ shell }).generate({ worktreePath: "/w" })
    ).rejects.toThrow(/not logged in/);
  });

  test("throws a generic message when the CLI fails silently", async () => {
    const { shell } = transcript([
      { stdout: " a | 1 +\n" },
      { stdout: "diff\n" },
      { exitCode: 127 },
    ]);
    await expect(
      new CommitMessageGenerator({ shell }).generate({ worktreePath: "/w" })
    ).rejects.toThrow(/claude CLI failed/);
  });

  test("throws when the CLI returns an empty message", async () => {
    const { shell } = transcript([
      { stdout: " a | 1 +\n" },
      { stdout: "diff\n" },
      { stdout: "   \n" },
    ]);
    await expect(
      new CommitMessageGenerator({ shell }).generate({ worktreePath: "/w" })
    ).rejects.toThrow(/empty message/);
  });
});
