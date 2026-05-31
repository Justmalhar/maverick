import { describe, test, expect } from "bun:test";
import { join } from "path";
import { InstructionsResolver } from "./instructions-resolver";

function makeFs(files: Record<string, string>) {
  return {
    exists: (p: string) => p in files,
    readFile: (p: string) => files[p] ?? "",
  };
}

describe("InstructionsResolver", () => {
  test("prefers MAVERICK.md over CLAUDE.md and AGENTS.md", () => {
    const wt = "/wt";
    const files = {
      [join(wt, "MAVERICK.md")]: "maverick rules",
      [join(wt, "CLAUDE.md")]: "claude rules",
      [join(wt, "AGENTS.md")]: "agents rules",
    };
    const r = new InstructionsResolver({ ...makeFs(files), home: "/home/x" });
    const result = r.resolve({ worktreePath: wt });
    expect(result.project).toBe("maverick rules");
    expect(result.projectSource).toBe("MAVERICK.md");
  });

  test("falls back to CLAUDE.md when MAVERICK.md is missing", () => {
    const wt = "/wt";
    const files = {
      [join(wt, "CLAUDE.md")]: "claude rules",
      [join(wt, "AGENTS.md")]: "agents rules",
    };
    const r = new InstructionsResolver({ ...makeFs(files), home: "/home/x" });
    expect(r.resolve({ worktreePath: wt }).projectSource).toBe("CLAUDE.md");
  });

  test("falls back to AGENTS.md when MAVERICK.md and CLAUDE.md are missing", () => {
    const wt = "/wt";
    const files = { [join(wt, "AGENTS.md")]: "agents rules" };
    const r = new InstructionsResolver({ ...makeFs(files), home: "/home/x" });
    const result = r.resolve({ worktreePath: wt });
    expect(result.projectSource).toBe("AGENTS.md");
    expect(result.project).toBe("agents rules");
  });

  test("returns empty project when no instruction file exists", () => {
    const r = new InstructionsResolver({ ...makeFs({}), home: "/home/x" });
    const result = r.resolve({ worktreePath: "/wt" });
    expect(result.project).toBe("");
    expect(result.projectSource).toBeNull();
  });

  test("skips an instruction file that only contains HTML comments", () => {
    const wt = "/wt";
    const files = {
      [join(wt, "MAVERICK.md")]: "<!-- only a comment -->",
      [join(wt, "CLAUDE.md")]: "real claude rules",
    };
    const r = new InstructionsResolver({ ...makeFs(files), home: "/home/x" });
    const result = r.resolve({ worktreePath: wt });
    // MAVERICK.md strips to empty, so the chain advances to CLAUDE.md.
    expect(result.projectSource).toBe("CLAUDE.md");
    expect(result.project).toBe("real claude rules");
  });

  test("reads and strips comments from the global ~/.maverick/MAVERICK.md", () => {
    const home = "/home/x";
    const files = {
      [join(home, ".maverick", "MAVERICK.md")]: "<!-- header -->\nglobal rules",
    };
    const r = new InstructionsResolver({ ...makeFs(files), home });
    const result = r.resolve({ worktreePath: "/wt" });
    expect(result.global).toBe("global rules");
    expect(result.project).toBe("");
  });
});
