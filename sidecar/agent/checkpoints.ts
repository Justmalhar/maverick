import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";
import { HARDENED_ENV, toolAugmentedPath } from "../deps";

async function run(cmd: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...HARDENED_ENV, PATH: toolAugmentedPath(), ...env },
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  if (proc.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${err || out}`);
  return out.trim();
}

export class CheckpointManager {
  /**
   * Commit the full working tree (tracked + untracked, .gitignore respected)
   * to refs/maverick/checkpoints/<sessionId> WITHOUT touching HEAD, the real
   * index, or the working tree. Uses a throwaway GIT_INDEX_FILE.
   */
  async snapshot(worktreePath: string, sessionId: string): Promise<string> {
    const tmpIndex = join(tmpdir(), `maverick-cpidx-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const env = { GIT_INDEX_FILE: tmpIndex };
    try {
      await run(["git", "add", "-A"], worktreePath, env);
      const tree = await run(["git", "write-tree"], worktreePath, env);
      let parent: string | null = null;
      try {
        parent = await run(["git", "rev-parse", "--verify", "HEAD"], worktreePath);
      } catch {
        /* unborn branch — parentless checkpoint commit */
      }
      const sha = await run(
        ["git", "commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", "maverick agent checkpoint"],
        worktreePath
      );
      await run(["git", "update-ref", `refs/maverick/checkpoints/${sessionId}`, sha], worktreePath);
      return sha;
    } finally {
      rmSync(tmpIndex, { force: true });
    }
  }

  /**
   * Make the working tree exactly match the snapshot: read-tree sets the index
   * to the snapshot, checkout-index writes every file, clean drops files that
   * did not exist at snapshot time (ignored files survive), and the final
   * mixed reset returns the index to HEAD so git status stays conventional.
   */
  async restore(worktreePath: string, sha: string): Promise<void> {
    await run(["git", "read-tree", sha], worktreePath);
    await run(["git", "checkout-index", "-f", "-a"], worktreePath);
    await run(["git", "clean", "-fd"], worktreePath);
    await run(["git", "reset", "-q"], worktreePath);
  }

  async dropRef(worktreePath: string, sessionId: string): Promise<void> {
    try {
      await run(["git", "update-ref", "-d", `refs/maverick/checkpoints/${sessionId}`], worktreePath);
    } catch {
      /* ref never created — nothing to drop */
    }
  }
}
