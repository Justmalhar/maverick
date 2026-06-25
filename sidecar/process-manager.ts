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
    return { proc, exited: proc.exited };
  }
}
