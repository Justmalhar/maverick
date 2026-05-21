import { describe, test, expect } from "bun:test";
import { DiffReader } from "./diff-reader";
import type { Shell } from "./types";

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 line a
-line b
+line b'
+line c
 line d
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,1 @@
+hello
`;

function shellWith(stdout: string, exitCode = 0, stderr = ""): { shell: Shell; calls: string[][] } {
  const calls: string[][] = [];
  const shell: Shell = {
    async text(cmd) {
      calls.push(cmd);
      return stdout;
    },
    async run(cmd) {
      calls.push(cmd);
      return { stdout, stderr, exitCode };
    },
  };
  return { shell, calls };
}

describe("DiffReader", () => {
  test("parse handles modified file with one hunk", () => {
    const files = DiffReader.parse(SAMPLE_DIFF);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("src/foo.ts");
    expect(files[0].status).toBe("M");
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
    expect(files[0].hunks).toHaveLength(1);
    expect(files[0].hunks[0].header).toContain("@@");
    expect(files[0].hunks[0].patch).toContain("diff --git");
  });

  test("parse detects added file", () => {
    const files = DiffReader.parse(SAMPLE_DIFF);
    expect(files[1].status).toBe("A");
    expect(files[1].path).toBe("new.txt");
  });

  test("parse returns empty array on empty input", () => {
    expect(DiffReader.parse("")).toEqual([]);
  });

  test("parse detects deletion", () => {
    const out = `diff --git a/d.txt b/d.txt
deleted file mode 100644
--- a/d.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
`;
    const files = DiffReader.parse(out);
    expect(files[0].status).toBe("D");
  });

  test("parse detects rename", () => {
    const out = `diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
@@ -1 +1 @@
-old
+new
`;
    const files = DiffReader.parse(out);
    expect(files[0].status).toBe("R");
  });

  test("get invokes git diff", async () => {
    const { shell, calls } = shellWith(SAMPLE_DIFF);
    const r = await new DiffReader({ shell }).get({ worktreePath: "/wt", filePath: "src/foo.ts" });
    expect(r.files).toHaveLength(2);
    expect(calls[0]).toContain("--unified=3");
    expect(calls[0]).toContain("src/foo.ts");
  });

  test("get omits filePath when not given", async () => {
    const { shell, calls } = shellWith("");
    await new DiffReader({ shell }).get({ worktreePath: "/wt" });
    expect(calls[0]).not.toContain("--");
  });

  test("stageHunk succeeds when git apply returns 0", async () => {
    const { shell } = shellWith("");
    const r = await new DiffReader({ shell }).stageHunk({ worktreePath: "/wt", patch: "x" });
    expect(r.ok).toBe(true);
  });

  test("stageHunk throws on failure", async () => {
    const { shell } = shellWith("", 1, "patch does not apply");
    await expect(
      new DiffReader({ shell }).stageHunk({ worktreePath: "/wt", patch: "x" })
    ).rejects.toThrow(/patch does not apply/);
  });

  test("unstageHunk succeeds", async () => {
    const { shell } = shellWith("");
    const r = await new DiffReader({ shell }).unstageHunk({ worktreePath: "/wt", patch: "x" });
    expect(r.ok).toBe(true);
  });

  test("unstageHunk throws on failure", async () => {
    const { shell } = shellWith("", 1, "bad");
    await expect(
      new DiffReader({ shell }).unstageHunk({ worktreePath: "/wt", patch: "x" })
    ).rejects.toThrow(/bad/);
  });

  test("default constructor builds without DI", () => {
    expect(new DiffReader()).toBeInstanceOf(DiffReader);
  });
});
