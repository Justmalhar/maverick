import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CheckpointManager } from "./checkpoints";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  if (proc.exitCode !== 0) throw new Error(await new Response(proc.stderr).text());
  return out.trim();
}

let repo: string;
const cp = new CheckpointManager();

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "mvck-cp-"));
  await git(repo, "init", "-b", "main");
  await git(repo, "config", "user.email", "t@t.t");
  await git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "one\n");
  await git(repo, "add", "-A");
  await git(repo, "commit", "-m", "init");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("CheckpointManager", () => {
  test("snapshot captures tracked modifications, untracked files, and deletions; restore reverts all three", async () => {
    writeFileSync(join(repo, "a.txt"), "one\nmodified\n");
    writeFileSync(join(repo, "untracked.txt"), "new\n");
    const sha = await cp.snapshot(repo, "sess1");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    // Mutate everything after the snapshot.
    writeFileSync(join(repo, "a.txt"), "trashed\n");
    rmSync(join(repo, "untracked.txt"));
    writeFileSync(join(repo, "later.txt"), "post-snapshot file\n");
    mkdirSync(join(repo, "newdir"));
    writeFileSync(join(repo, "newdir", "x.txt"), "x\n");

    await cp.restore(repo, sha);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("one\nmodified\n");
    expect(readFileSync(join(repo, "untracked.txt"), "utf8")).toBe("new\n");
    expect(existsSync(join(repo, "later.txt"))).toBe(false);
    expect(existsSync(join(repo, "newdir"))).toBe(false);
    // HEAD/branch untouched; snapshot invisible to normal git log.
    expect(await git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  test("snapshot does not disturb the working tree, index, or status", async () => {
    writeFileSync(join(repo, "a.txt"), "one\ndirty\n");
    const statusBefore = await git(repo, "status", "--porcelain");
    await cp.snapshot(repo, "sess1");
    expect(await git(repo, "status", "--porcelain")).toBe(statusBefore);
  });

  test("snapshot on an unborn HEAD produces a parentless commit and restore still works", async () => {
    const bare = mkdtempSync(join(tmpdir(), "mvck-cp-unborn-"));
    try {
      await git(bare, "init", "-b", "main");
      await git(bare, "config", "user.email", "t@t.t");
      await git(bare, "config", "user.name", "t");
      writeFileSync(join(bare, "first.txt"), "hello\n");

      const sha = await cp.snapshot(bare, "sess1");
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      expect(await git(bare, "rev-parse", "refs/maverick/checkpoints/sess1")).toBe(sha);
      const commit = await git(bare, "cat-file", "-p", sha);
      expect(commit).not.toContain("parent ");

      writeFileSync(join(bare, "first.txt"), "trashed\n");
      await cp.restore(bare, sha);
      expect(readFileSync(join(bare, "first.txt"), "utf8")).toBe("hello\n");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  test("restore rejects with the failing git command when given a bad sha", async () => {
    const badSha = "0".repeat(40);
    await expect(cp.restore(repo, badSha)).rejects.toThrow(/read-tree/);
  });

  test("snapshot on a nonexistent worktree rejects and cleans up its temp index", async () => {
    await expect(cp.snapshot("/path/that/does/not/exist", "s")).rejects.toThrow();
  });

  test("snapshots stack on the session ref and dropRef removes it", async () => {
    const sha1 = await cp.snapshot(repo, "sess1");
    writeFileSync(join(repo, "b.txt"), "b\n");
    const sha2 = await cp.snapshot(repo, "sess1");
    expect(sha1).not.toBe(sha2);
    expect(await git(repo, "rev-parse", "refs/maverick/checkpoints/sess1")).toBe(sha2);
    await cp.dropRef(repo, "sess1");
    await expect(git(repo, "rev-parse", "refs/maverick/checkpoints/sess1")).rejects.toThrow();
  });
});
