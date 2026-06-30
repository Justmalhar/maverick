import { describe, test, expect } from "bun:test";
import { PrTextGenerator } from "./pr-text-generator";
import type { Shell } from "./types";

function transcript(steps: Array<{ stdout?: string; stderr?: string; exitCode?: number }>): {
  shell: Shell;
  calls: string[][];
  stdins: Array<string | undefined>;
} {
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

describe("PrTextGenerator", () => {
  test("first line → title, rest → body; feeds log+stat over stdin", async () => {
    const { shell, calls, stdins } = transcript([
      { stdout: "feat: a\nfix: b\n" },
      { stdout: " src/a.ts | 2 +-\n" },
      { stdout: "Add export button\n\nIntroduces a button that exports the table.\n" },
    ]);
    const r = await new PrTextGenerator({ shell }).generate({ worktreePath: "/w", base: "main" });
    expect(r.title).toBe("Add export button");
    expect(r.body).toBe("Introduces a button that exports the table.");
    expect(calls[0]).toEqual(["git", "-C", "/w", "log", "main..HEAD", "--pretty=format:%s"]);
    expect(calls[1]).toEqual(["git", "-C", "/w", "diff", "--stat", "main..HEAD"]);
    expect(stdins[2]).toContain("pull request");
  });

  test("weaves the createPr instructions into the prompt", async () => {
    const { shell, stdins } = transcript([
      { stdout: "feat: a\n" },
      { stdout: " a | 1 +\n" },
      { stdout: "Title\n\nBody\n" },
    ]);
    await new PrTextGenerator({ shell }).generate({
      worktreePath: "/w",
      base: "main",
      instructions: "Always start the title with [JIRA-123]",
    });
    expect(stdins[2]).toContain("[JIRA-123]");
  });

  test("title-only output yields empty body", async () => {
    const { shell } = transcript([
      { stdout: "feat: a\n" },
      { stdout: " a | 1 +\n" },
      { stdout: "Just a title\n" },
    ]);
    const r = await new PrTextGenerator({ shell }).generate({ worktreePath: "/w", base: "main" });
    expect(r.title).toBe("Just a title");
    expect(r.body).toBe("");
  });

  test("runs the injected agent spec", async () => {
    const { shell, calls } = transcript([
      { stdout: "feat: a\n" },
      { stdout: " a | 1 +\n" },
      { stdout: "T\n\nB\n" },
    ]);
    await new PrTextGenerator({ shell }).generate({
      worktreePath: "/w",
      base: "main",
      agent: { command: "codex", args: ["exec"] },
    });
    expect(calls[2]).toEqual(["codex", "exec"]);
  });

  test("throws when the agent fails", async () => {
    const { shell } = transcript([
      { stdout: "feat: a\n" },
      { stdout: " a | 1 +\n" },
      { exitCode: 1, stderr: "not logged in" },
    ]);
    await expect(
      new PrTextGenerator({ shell }).generate({ worktreePath: "/w", base: "main" })
    ).rejects.toThrow(/not logged in/);
  });
});
