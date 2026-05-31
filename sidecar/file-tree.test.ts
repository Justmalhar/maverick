import { describe, test, expect } from "bun:test";
import { FileTree } from "./file-tree";
import type { Shell } from "./types";

interface FakeFs {
  dirs: Set<string>;
  files: Map<string, string>;
}

function makeFs(): FakeFs {
  return {
    dirs: new Set(["/r", "/r/src", "/r/.git", "/r/node_modules"]),
    files: new Map([
      ["/r/README.md", ""],
      ["/r/src/index.ts", ""],
      ["/r/src/util.ts", ""],
      ["/r/.git/config", ""],
      ["/r/node_modules/pkg.json", ""],
    ]),
  };
}

function makeTree(fs: FakeFs, status = ""): FileTree {
  const shell: Shell = {
    async text() {
      return status;
    },
    async run() {
      return { stdout: status, stderr: "", exitCode: 0 };
    },
  };
  return new FileTree({
    shell,
    readdir(p) {
      const entries: string[] = [];
      for (const d of fs.dirs) {
        if (d !== p && d.startsWith(p + "/") && !d.slice(p.length + 1).includes("/")) {
          entries.push(d.slice(p.length + 1));
        }
      }
      for (const f of fs.files.keys()) {
        if (f.startsWith(p + "/") && !f.slice(p.length + 1).includes("/")) {
          entries.push(f.slice(p.length + 1));
        }
      }
      return entries;
    },
    stat(p) {
      return { isDirectory: fs.dirs.has(p) };
    },
  });
}

describe("FileTree", () => {
  test("walks worktree and excludes ignored dirs", async () => {
    const tree = await makeTree(makeFs()).tree({ worktreePath: "/r" });
    const names = tree.map((e) => e.name).sort();
    expect(names).toContain("src");
    expect(names).toContain("README.md");
    expect(names).not.toContain(".git");
    expect(names).not.toContain("node_modules");
  });

  test("recurses into directories", async () => {
    const tree = await makeTree(makeFs()).tree({ worktreePath: "/r" });
    const src = tree.find((e) => e.name === "src");
    expect(src?.children?.map((c) => c.name).sort()).toEqual(["index.ts", "util.ts"]);
  });

  test("applies git status to file entries", async () => {
    const status = " M src/index.ts\n?? new.txt\n D removed.txt\n";
    const fs = makeFs();
    fs.files.set("/r/new.txt", "");
    fs.files.set("/r/removed.txt", "");
    const entries = await makeTree(fs, status).tree({ worktreePath: "/r" });
    const idx = entries.find((e) => e.name === "src")?.children?.find((c) => c.name === "index.ts");
    expect(idx?.status).toBe("M");
    const newFile = entries.find((e) => e.name === "new.txt");
    expect(newFile?.status).toBe("A");
    const removed = entries.find((e) => e.name === "removed.txt");
    expect(removed?.status).toBe("D");
  });

  test("paths are RELATIVE to the worktree (porcelain-status mapping depends on it)", async () => {
    const status = " M src/index.ts\n";
    const entries = await makeTree(makeFs(), status).tree({ worktreePath: "/r" });
    const src = entries.find((e) => e.name === "src");
    // Top-level dir path is the bare relative segment, not an absolute path.
    expect(src?.path).toBe("src");
    const idx = src?.children?.find((c) => c.name === "index.ts");
    // Nested path is relative and forward-slash joined; this is exactly the key
    // `git status --porcelain` reports, so the M status attaches correctly.
    expect(idx?.path).toBe("src/index.ts");
    expect(idx?.status).toBe("M");
  });

  test("respects maxDepth", async () => {
    const fs = makeFs();
    fs.dirs.add("/r/src/deep");
    fs.files.set("/r/src/deep/leaf.ts", "");
    const tree = await makeTree(fs).tree({ worktreePath: "/r", maxDepth: 1 });
    const src = tree.find((e) => e.name === "src");
    const deep = src?.children?.find((c) => c.name === "deep");
    expect(deep?.children).toEqual([]);
  });

  test("user-supplied ignore is honored", async () => {
    const tree = await makeTree(makeFs()).tree({ worktreePath: "/r", ignore: ["src"] });
    expect(tree.find((e) => e.name === "src")).toBeUndefined();
  });

  test("collectStatus returns empty map when shell errors", async () => {
    const fs = makeFs();
    const shell: Shell = {
      async text() {
        throw new Error("no git");
      },
      async run() {
        throw new Error("no git");
      },
    };
    const tree = new FileTree({
      shell,
      readdir(p) {
        if (p === "/r") return ["README.md"];
        return [];
      },
      stat() {
        return { isDirectory: false };
      },
    });
    const entries = await tree.tree({ worktreePath: "/r" });
    expect(entries[0].status).toBeUndefined();
  });

  test("readdir error skips directory", async () => {
    const tree = new FileTree({
      shell: { async text() { return ""; }, async run() { return { stdout: "", stderr: "", exitCode: 0 }; } },
      readdir(p) {
        if (p === "/r") return ["sub"];
        throw new Error("denied");
      },
      stat() {
        return { isDirectory: true };
      },
    });
    const entries = await tree.tree({ worktreePath: "/r" });
    expect(entries[0].children).toEqual([]);
  });

  test("stat error skips entry", async () => {
    const tree = new FileTree({
      shell: { async text() { return ""; }, async run() { return { stdout: "", stderr: "", exitCode: 0 }; } },
      readdir() {
        return ["a", "b"];
      },
      stat(p) {
        if (p.endsWith("/a")) throw new Error("perm");
        return { isDirectory: false };
      },
    });
    const entries = await tree.tree({ worktreePath: "/r" });
    expect(entries.map((e) => e.name)).toEqual(["b"]);
  });

  test("default constructor builds without DI", () => {
    expect(new FileTree()).toBeInstanceOf(FileTree);
  });

  test("default readdir/stat walk a real temp directory", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const tmp = mkdtempSync(join(tmpdir(), "mvk-tree-"));
    try {
      mkdirSync(join(tmp, "src"));
      writeFileSync(join(tmp, "a.txt"), "x");
      writeFileSync(join(tmp, "src", "b.txt"), "y");
      const tree = new FileTree();
      const entries = await tree.tree({ worktreePath: tmp });
      const names = entries.map((e) => e.name).sort();
      expect(names).toContain("a.txt");
      expect(names).toContain("src");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
