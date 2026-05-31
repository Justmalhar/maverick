import { describe, test, expect } from "bun:test";
import { FileSearch } from "./file-search";
import type { Shell } from "./types";

function gitShell(files: string[]): Shell {
  return {
    async text(cmd) {
      if (cmd.includes("ls-files")) return files.join("\0") + (files.length ? "\0" : "");
      return "";
    },
    async run() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
}

const noGitShell: Shell = {
  async text() {
    throw new Error("not a git repo");
  },
  async run() {
    return { stdout: "", stderr: "", exitCode: 0 };
  },
};

describe("FileSearch (git path)", () => {
  test("returns empty for blank query without scanning", async () => {
    const fs = new FileSearch({ shell: gitShell(["a.ts"]) });
    expect(await fs.search({ worktreePath: "/r", query: "   " })).toEqual({
      hits: [],
      truncated: false,
    });
  });

  test("matches relative path substring, case-insensitive", async () => {
    const fs = new FileSearch({
      shell: gitShell(["src/Index.ts", "src/util.ts", "README.md"]),
    });
    const res = await fs.search({ worktreePath: "/r", query: "index" });
    expect(res.hits.map((h) => h.rel)).toEqual(["src/Index.ts"]);
    expect(res.hits[0].name).toBe("Index.ts");
    expect(res.truncated).toBe(false);
  });

  test("ranks filename matches before path-only matches, then by length", async () => {
    const fs = new FileSearch({
      shell: gitShell(["foo/bar.ts", "x/foo.ts", "deep/nested/foo.ts"]),
    });
    const res = await fs.search({ worktreePath: "/r", query: "foo" });
    // x/foo.ts and deep/nested/foo.ts are filename matches (foo in name);
    // foo/bar.ts is path-only. Filename matches first, shorter rel first.
    expect(res.hits[0].rel).toBe("x/foo.ts");
    expect(res.hits[1].rel).toBe("deep/nested/foo.ts");
    expect(res.hits[2].rel).toBe("foo/bar.ts");
  });

  test("prunes SKIP_DIRS segments from git output", async () => {
    const fs = new FileSearch({
      shell: gitShell(["node_modules/dep/index.ts", "src/index.ts"]),
    });
    const res = await fs.search({ worktreePath: "/r", query: "index" });
    expect(res.hits.map((h) => h.rel)).toEqual(["src/index.ts"]);
  });

  test("limit caps results and sets truncated", async () => {
    const files = Array.from({ length: 10 }, (_, i) => `match-${i}.ts`);
    const fs = new FileSearch({ shell: gitShell(files) });
    const res = await fs.search({ worktreePath: "/r", query: "match", limit: 3 });
    expect(res.hits.length).toBe(3);
    expect(res.truncated).toBe(true);
  });

  test("MAX_SCANNED budget truncates the git list", async () => {
    const files = ["a-match.ts", "b-match.ts", "c-match.ts"];
    const fs = new FileSearch({ shell: gitShell(files), maxScanned: 2 });
    const res = await fs.search({ worktreePath: "/r", query: "match" });
    expect(res.truncated).toBe(true);
  });

  test("handles empty git output", async () => {
    const fs = new FileSearch({ shell: gitShell([]) });
    const res = await fs.search({ worktreePath: "/r", query: "x" });
    expect(res.hits).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  test("every hit is a file (files-only finder)", async () => {
    const fs = new FileSearch({
      shell: gitShell(["src/a.ts", "src/nested/b.ts", "docs/c.md"]),
    });
    const res = await fs.search({ worktreePath: "/r", query: "." });
    expect(res.hits.length).toBeGreaterThan(0);
    expect(res.hits.every((h) => h.isDirectory === false)).toBe(true);
  });
});

describe("FileSearch (walk fallback)", () => {
  function makeWalk(dirs: Set<string>, files: Set<string>, maxScanned?: number) {
    return new FileSearch({
      shell: noGitShell,
      maxScanned,
      readdir(p) {
        const out: string[] = [];
        for (const d of dirs) {
          if (d !== p && d.startsWith(p + "/") && !d.slice(p.length + 1).includes("/")) {
            out.push(d.slice(p.length + 1));
          }
        }
        for (const f of files) {
          if (f.startsWith(p + "/") && !f.slice(p.length + 1).includes("/")) {
            out.push(f.slice(p.length + 1));
          }
        }
        return out;
      },
      stat(p) {
        return { isDirectory: dirs.has(p) };
      },
    });
  }

  test("walks the tree honoring SKIP_DIRS when git is unavailable", async () => {
    const dirs = new Set(["/r", "/r/src", "/r/node_modules"]);
    const files = new Set([
      "/r/README.md",
      "/r/src/index.ts",
      "/r/node_modules/pkg/index.ts",
    ]);
    const fs = makeWalk(dirs, files);
    const res = await fs.search({ worktreePath: "/r", query: "index" });
    expect(res.hits.map((h) => h.rel)).toEqual(["src/index.ts"]);
  });

  test("readdir errors are skipped", async () => {
    const fs = new FileSearch({
      shell: noGitShell,
      readdir(p) {
        if (p === "/r") return ["sub"];
        throw new Error("denied");
      },
      stat() {
        return { isDirectory: true };
      },
    });
    const res = await fs.search({ worktreePath: "/r", query: "sub" });
    // "sub" is a directory; directories are descended, not matched as files.
    expect(res.hits).toEqual([]);
  });

  test("stat errors skip the entry", async () => {
    const fs = new FileSearch({
      shell: noGitShell,
      readdir(p) {
        return p === "/r" ? ["a.ts", "b.ts"] : [];
      },
      stat(p) {
        if (p.endsWith("/a.ts")) throw new Error("perm");
        return { isDirectory: false };
      },
    });
    const res = await fs.search({ worktreePath: "/r", query: ".ts" });
    expect(res.hits.map((h) => h.rel)).toEqual(["b.ts"]);
  });

  test("MAX_SCANNED budget truncates the walk", async () => {
    const dirs = new Set(["/r", "/r/d1", "/r/d1/d2"]);
    const files = new Set([
      "/r/m1.ts",
      "/r/d1/m2.ts",
      "/r/d1/d2/m3.ts",
      "/r/d1/d2/m4.ts",
    ]);
    const fs = makeWalk(dirs, files, 2);
    const res = await fs.search({ worktreePath: "/r", query: "m" });
    expect(res.truncated).toBe(true);
  });

  test("default constructor builds without DI", () => {
    expect(new FileSearch()).toBeInstanceOf(FileSearch);
  });
});
