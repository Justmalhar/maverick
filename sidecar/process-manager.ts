export interface ManagedProc {
  kill(signal?: string | number): void;
  stdin?: { write(data: string | Uint8Array): unknown | Promise<unknown>; flush?(): unknown };
  stdout?: ReadableStream<Uint8Array>;
  stderr?: ReadableStream<Uint8Array>;
  exitCode: number | null;
  exited: Promise<number>;
}

export type Spawner = (cmd: string[], opts: { cwd?: string; env?: Record<string, string> }) => ManagedProc;

export const defaultSpawner: Spawner = (cmd, opts) =>
  Bun.spawn(cmd, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
  }) as unknown as ManagedProc;

export interface ProcessManagerOptions {
  spawn?: Spawner;
}

// Read a child's stdout/stderr pipe to completion, discarding the bytes. A
// piped stream that is never read fills its OS buffer (~64KB) and then blocks
// the child on its next write — a permanent deadlock for a chatty child. We
// don't need the output here (these are fire-and-forget children), we just have
// to keep the pipe empty. Errors (stream aborted on kill) are swallowed.
function drain(stream?: ReadableStream<Uint8Array>): void {
  if (!stream || typeof stream.getReader !== "function") return;
  const reader = stream.getReader();
  void (async () => {
    try {
      while (!(await reader.read()).done) { /* discard */ }
    } catch {
      /* stream closed/aborted (e.g. on kill) — nothing left to drain */
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  })();
}

/**
 * Spawns short-lived, fire-and-forget child processes (the workspace.destroy
 * archive script). Interactive PTYs are NOT owned here — every terminal/agent/
 * preset PTY is spawned through the Rust ConPTY path (pty_spawn) and driven from
 * the frontend; the former Bun-pipe pseudo-PTY surface was removed because the
 * frontend could never display or drive it.
 */
export class ProcessManager {
  private spawner: Spawner;

  constructor(opts: ProcessManagerOptions = {}) {
    this.spawner = opts.spawn ?? defaultSpawner;
  }

  async spawnOnce(opts: { cwd: string; command: string; args: string[]; env?: Record<string, string> }): Promise<{ code: number }> {
    const { exited } = this.spawnOnceHandle(opts);
    const code = await exited;
    return { code };
  }

  // Returns the live child alongside its exit promise so a caller racing a
  // timeout can kill() the still-running process instead of leaking it. Callers
  // that don't need the handle should use spawnOnce, which discards it.
  spawnOnceHandle(opts: { cwd: string; command: string; args: string[]; env?: Record<string, string> }): {
    proc: ManagedProc;
    exited: Promise<number>;
  } {
    const proc = this.spawner([opts.command, ...opts.args], { cwd: opts.cwd, env: opts.env });
    // Drain both pipes so a child that logs heavily to stderr (or stdout) can't
    // deadlock on a full buffer before it exits.
    drain(proc.stdout);
    drain(proc.stderr);
    return { proc, exited: proc.exited };
  }
}
