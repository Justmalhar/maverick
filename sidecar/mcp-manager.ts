import { defaultSpawner } from "./process-manager";
import type { Spawner, ManagedProc } from "./process-manager";
import { ConfigLoader } from "./config-loader";
import { LogRing } from "./log-ring";
import { emit, stdoutNotifier } from "./deps";
import type { MCPServer, MCPStatus, Notifier } from "./types";

interface MCPEntry {
  proc: ManagedProc;
  name: string;
  pid: number;
  command: string;
  args: string[];
  env?: Record<string, string>;
  status: MCPStatus;
  restarts: number;
  logs: LogRing;
  // Epoch (ms) at which an auto-restart becomes eligible after a crash backoff.
  // Until `now()` reaches it, `tick()` leaves the server in "restarting".
  nextRetryAt: number;
  // Set when stop() was called so the exit handler does not auto-restart a
  // server the user deliberately took down.
  stopping: boolean;
  // Discriminates a stale exit callback (from a process we already replaced)
  // from the current one, so a late exit can't clobber a fresh entry.
  generation: number;
}

export interface MCPManagerOptions {
  spawn?: Spawner;
  loader?: ConfigLoader;
  projectPath?: string;
  notifier?: Notifier;
  now?: () => number;
  /** Per-server crash cap before the manager gives up auto-restarting. */
  maxRetries?: number;
  /** Base backoff in ms; doubled per consecutive restart (capped at 30s). */
  baseBackoffMs?: number;
  /** Ring-buffer cap per server (bytes). */
  logCap?: number;
}

const MAX_BACKOFF_MS = 30_000;

export class MCPManager {
  private servers = new Map<string, MCPEntry>();
  private spawner: Spawner;
  private loader: ConfigLoader;
  private projectPath: string | undefined;
  private notifier: Notifier;
  private now: () => number;
  private maxRetries: number;
  private baseBackoffMs: number;
  private logCap: number;

  constructor(opts: MCPManagerOptions = {}) {
    this.spawner = opts.spawn ?? defaultSpawner;
    this.loader = opts.loader ?? new ConfigLoader();
    this.projectPath = opts.projectPath;
    this.notifier = opts.notifier ?? stdoutNotifier;
    this.now = opts.now ?? (() => Date.now());
    this.maxRetries = opts.maxRetries ?? 5;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1_000;
    this.logCap = opts.logCap ?? 256 * 1024;
  }

  setProjectPath(path: string): void {
    this.projectPath = path;
  }

  start(name: string): { pid: number } {
    const existing = this.servers.get(name);
    if (existing && existing.status === "running") return { pid: existing.pid };
    if (!this.projectPath) throw new Error("MCPManager: projectPath not set");
    const config = this.loader.load(this.projectPath);
    const def = (config.mcps ?? []).find((m) => m.name === name);
    if (!def) throw new Error(`MCP server "${name}" not configured`);
    // A manual start clears any crash backoff/retry budget for this server.
    return this.spawnEntry({
      name,
      command: def.command,
      args: def.args,
      env: def.env,
      restarts: 0,
      logs: existing?.logs ?? new LogRing(this.logCap),
    });
  }

  private spawnEntry(seed: {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    restarts: number;
    logs: LogRing;
  }): { pid: number } {
    const proc = this.spawner([seed.command, ...seed.args], { env: seed.env });
    const pid = (proc as unknown as { pid?: number }).pid ?? -1;
    const generation = (this.servers.get(seed.name)?.generation ?? 0) + 1;
    const entry: MCPEntry = {
      proc,
      name: seed.name,
      pid,
      command: seed.command,
      args: seed.args,
      env: seed.env,
      status: "running",
      restarts: seed.restarts,
      logs: seed.logs,
      nextRetryAt: 0,
      stopping: false,
      generation,
    };
    this.servers.set(seed.name, entry);
    void this.pump(seed.name, proc, proc.stdout, generation);
    void this.pump(seed.name, proc, proc.stderr, generation);
    void this.watchExit(seed.name, proc, generation);
    return { pid };
  }

  private async pump(
    name: string,
    proc: ManagedProc,
    stream: ReadableStream<Uint8Array> | undefined,
    generation: number
  ): Promise<void> {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const entry = this.servers.get(name);
        if (entry && entry.generation === generation) entry.logs.push(decoder.decode(value));
      }
    } catch {
      /* stream torn down on kill — nothing left to capture */
    }
  }

  private async watchExit(name: string, proc: ManagedProc, generation: number): Promise<void> {
    const code = await proc.exited.catch(() => proc.exitCode ?? 0);
    const entry = this.servers.get(name);
    if (!entry || entry.generation !== generation) return;
    if (entry.stopping) {
      entry.status = "stopped";
      return;
    }
    // Unexpected exit: schedule an auto-restart unless the retry budget is spent.
    if (entry.restarts >= this.maxRetries) {
      entry.status = "crashed";
      this.emitStatus(entry, code);
      return;
    }
    entry.restarts += 1;
    const backoff = Math.min(this.baseBackoffMs * 2 ** (entry.restarts - 1), MAX_BACKOFF_MS);
    entry.nextRetryAt = this.now() + backoff;
    entry.status = "restarting";
    this.emitStatus(entry, code);
  }

  // Drives backoff-gated restarts. A host loop calls this on an interval; tests
  // call it directly after advancing the injected clock.
  tick(): void {
    for (const entry of this.servers.values()) {
      if (entry.status !== "restarting") continue;
      if (this.now() < entry.nextRetryAt) continue;
      this.spawnEntry({
        name: entry.name,
        command: entry.command,
        args: entry.args,
        env: entry.env,
        restarts: entry.restarts,
        logs: entry.logs,
      });
    }
  }

  private emitStatus(entry: MCPEntry, exitCode: number): void {
    emit(this.notifier, "mcp.status", {
      name: entry.name,
      status: entry.status,
      restarts: entry.restarts,
      exitCode,
    });
  }

  stop(name: string): { ok: true } {
    const entry = this.servers.get(name);
    if (entry) {
      entry.stopping = true;
      entry.status = "stopped";
      entry.proc.kill();
      this.servers.delete(name);
    }
    return { ok: true };
  }

  list(): MCPServer[] {
    return [...this.servers.values()].map((e) => ({
      name: e.name,
      command: e.command,
      args: e.args,
      status: this.health(e.name),
      pid: e.pid,
      restarts: e.restarts,
    }));
  }

  logs(name: string, sinceOffset = 0): { data: string; nextOffset: number; dropped: number } {
    const entry = this.servers.get(name);
    if (!entry) return { data: "", nextOffset: 0, dropped: 0 };
    return entry.logs.readFrom(sinceOffset);
  }

  health(name: string): MCPStatus {
    const entry = this.servers.get(name);
    if (!entry) return "stopped";
    if (entry.status === "restarting" || entry.status === "crashed") return entry.status;
    if (entry.proc.exitCode === null) return "running";
    return entry.proc.exitCode === 0 ? "stopped" : "error";
  }
}
