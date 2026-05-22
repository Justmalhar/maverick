import { defaultIds, emit, stdoutNotifier } from "./deps";
import type { IdProvider, Notifier } from "./types";

export interface ManagedProc {
  kill(signal?: string | number): void;
  stdin?: { write(data: string | Uint8Array): unknown | Promise<unknown>; flush?(): unknown };
  stdout?: ReadableStream<Uint8Array>;
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

interface PtyEntry {
  proc: ManagedProc;
  workspaceId: string;
  cols: number;
  rows: number;
}

interface SpawnParams {
  workspaceId: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface ProcessManagerOptions {
  spawn?: Spawner;
  notifier?: Notifier;
  ids?: IdProvider;
}

export class ProcessManager {
  private ptys = new Map<string, PtyEntry>();
  private spawner: Spawner;
  private notifier: Notifier;
  private ids: IdProvider;

  constructor(opts: ProcessManagerOptions = {}) {
    this.spawner = opts.spawn ?? defaultSpawner;
    this.notifier = opts.notifier ?? stdoutNotifier;
    this.ids = opts.ids ?? defaultIds;
  }

  spawn(params: SpawnParams): { ptyId: string } {
    const ptyId = this.ids.uuid("pty");
    const proc = this.spawner([params.command, ...params.args], {
      cwd: params.cwd,
      env: params.env,
    });
    this.ptys.set(ptyId, { proc, workspaceId: params.workspaceId, cols: 80, rows: 24 });
    void this.pumpStdout(ptyId, proc);
    return { ptyId };
  }

  async write(params: { ptyId: string; data: string }): Promise<{ ok: true }> {
    const entry = this.ptys.get(params.ptyId);
    if (!entry) throw new Error(`PTY not found: ${params.ptyId}`);
    if (!entry.proc.stdin) throw new Error(`PTY stdin not writable: ${params.ptyId}`);
    await entry.proc.stdin.write(params.data);
    return { ok: true };
  }

  resize(params: { ptyId: string; cols: number; rows: number }): { ok: true } {
    const entry = this.ptys.get(params.ptyId);
    if (!entry) throw new Error(`PTY not found: ${params.ptyId}`);
    entry.cols = params.cols;
    entry.rows = params.rows;
    return { ok: true };
  }

  kill(params: { ptyId: string }): { ok: true } {
    const entry = this.ptys.get(params.ptyId);
    if (!entry) return { ok: true };
    entry.proc.kill();
    this.ptys.delete(params.ptyId);
    return { ok: true };
  }

  async spawnOnce(opts: { cwd: string; command: string; args: string[]; env?: Record<string, string> }): Promise<{ code: number }> {
    const proc = this.spawner([opts.command, ...opts.args], { cwd: opts.cwd, env: opts.env });
    const code = await proc.exited;
    return { code };
  }

  has(ptyId: string): boolean {
    return this.ptys.has(ptyId);
  }

  size(): number {
    return this.ptys.size;
  }

  private async pumpStdout(ptyId: string, proc: ManagedProc): Promise<void> {
    if (proc.stdout) {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          emit(this.notifier, "pty.data", { ptyId, data: decoder.decode(value) });
        }
      } catch (err) {
        emit(this.notifier, "pty.error", { ptyId, message: err instanceof Error ? err.message : String(err) });
      }
    }
    const code = await proc.exited.catch(() => proc.exitCode ?? 0);
    emit(this.notifier, "pty.exit", { ptyId, code });
    this.ptys.delete(ptyId);
  }
}
