import { describe, test, expect } from "bun:test";
import { BranchNameGenerator } from "./branch-name-generator";
import type { Shell } from "./types";

function fakeShell(result: { stdout?: string; stderr?: string; exitCode?: number }): {
  shell: Shell;
  calls: string[][];
  stdins: (string | undefined)[];
} {
  const calls: string[][] = [];
  const stdins: (string | undefined)[] = [];
  const shell: Shell = {
    text: async () => "",
    run: async (cmd: string[], _cwd?: string, stdin?: string) => {
      calls.push(cmd);
      stdins.push(stdin);
      return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.exitCode ?? 0 };
    },
  };
  return { shell, calls, stdins };
}

describe("BranchNameGenerator", () => {
  test("runs claude -p with the task over stdin and returns the trimmed name", async () => {
    const { shell, calls, stdins } = fakeShell({ stdout: "fix-login-auth\n" });
    const r = await new BranchNameGenerator({ shell }).generate({ prompt: "Fix the login bug" });
    expect(r.name).toBe("fix-login-auth");
    expect(calls[0]).toEqual(["claude", "-p", "--output-format", "text"]);
    expect(stdins[0]).toContain("Fix the login bug");
  });

  test("throws when the CLI exits non-zero", async () => {
    const { shell } = fakeShell({ exitCode: 1, stderr: "not logged in" });
    await expect(new BranchNameGenerator({ shell }).generate({ prompt: "x" })).rejects.toThrow();
  });

  test("throws on empty output", async () => {
    const { shell } = fakeShell({ stdout: "   " });
    await expect(new BranchNameGenerator({ shell }).generate({ prompt: "x" })).rejects.toThrow();
  });
});
