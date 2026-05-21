import { defaultSpawner } from "./process-manager";
import type { Spawner, ManagedProc } from "./process-manager";
import { ConfigLoader } from "./config-loader";
import type { MCPServer } from "./types";

interface MCPEntry {
  proc: ManagedProc;
  name: string;
  pid: number;
  command: string;
  args: string[];
}

export interface MCPManagerOptions {
  spawn?: Spawner;
  loader?: ConfigLoader;
  projectPath?: string;
}

export class MCPManager {
  private servers = new Map<string, MCPEntry>();
  private spawner: Spawner;
  private loader: ConfigLoader;
  private projectPath: string | undefined;

  constructor(opts: MCPManagerOptions = {}) {
    this.spawner = opts.spawn ?? defaultSpawner;
    this.loader = opts.loader ?? new ConfigLoader();
    this.projectPath = opts.projectPath;
  }

  setProjectPath(path: string): void {
    this.projectPath = path;
  }

  start(name: string): { pid: number } {
    const existing = this.servers.get(name);
    if (existing) return { pid: existing.pid };
    if (!this.projectPath) throw new Error("MCPManager: projectPath not set");
    const config = this.loader.load(this.projectPath);
    const def = (config.mcps ?? []).find((m) => m.name === name);
    if (!def) throw new Error(`MCP server "${name}" not configured`);
    const proc = this.spawner([def.command, ...def.args], { env: def.env });
    const pidCandidate = (proc as unknown as { pid?: number }).pid ?? -1;
    this.servers.set(name, { proc, name, pid: pidCandidate, command: def.command, args: def.args });
    return { pid: pidCandidate };
  }

  stop(name: string): { ok: true } {
    const entry = this.servers.get(name);
    if (entry) {
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
      status: e.proc.exitCode === null ? "running" : "stopped",
      pid: e.pid,
    }));
  }

  health(name: string): "running" | "stopped" | "error" {
    const entry = this.servers.get(name);
    if (!entry) return "stopped";
    if (entry.proc.exitCode === null) return "running";
    return entry.proc.exitCode === 0 ? "stopped" : "error";
  }
}
