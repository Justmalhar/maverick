import { defaultIds, emit, stdoutNotifier } from "./deps";
import { defaultSpawner, type ManagedProc, type Spawner } from "./process-manager";
import type { IdProvider, Notifier } from "./types";

// Headless agent execution: spawns an agent CLI in non-interactive print mode,
// feeds the prompt on stdin, and STREAMS its output as `agent.data`/`agent.exit`/
// `agent.error` notifications (Rust maps `agent.*` → `agent:*` Tauri events with
// no extra forwarding code, exactly like `pty.*`). Unlike the interactive PTY
// path this needs no shell and no terminal surface.
//
// Validated on Windows (spike 2026-06-25, claude 2.1.173):
//  - `Bun.spawn(["claude", …])` resolves the npm shim (no ENOENT).
//  - `--permission-mode acceptEdits` lets the agent edit files with no prompt.
//  - stream-json carries a session_id; `--resume <id>` continues a prior turn.

export interface AgentRunParams {
  workspaceId: string;
  backend: string;
  prompt: string;
  cwd?: string;
  env?: Record<string, string>;
  // Continue a prior turn (review comments, fix-errors, …) in the same session.
  resumeSessionId?: string;
  // Defaults to "acceptEdits" — edits in the worktree without prompting, while
  // still gating anything riskier. "dangerously-skip-permissions" is opt-in.
  permissionMode?: string;
}

// Per-backend headless argv. Only backends proven to support a streaming,
// non-interactive mode are listed; everything else is unsupported and the
// caller must fall back to the interactive terminal launch surface rather than
// spawn a broken `-p`. claude-code is spike-verified; others added as verified.
const HEADLESS_ARGV: Record<string, (p: AgentRunParams) => string[]> = {
  "claude-code": (p) => [
    "claude",
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    p.permissionMode ?? "acceptEdits",
    ...(p.resumeSessionId ? ["--resume", p.resumeSessionId] : []),
  ],
};

/** True when the backend has a verified headless mode; else the caller should use the terminal. */
export function supportsHeadless(backend: string): boolean {
  return Object.prototype.hasOwnProperty.call(HEADLESS_ARGV, backend);
}

/**
 * The headless CLI argv for a backend (prompt fed on stdin), or null if the
 * backend has no verified headless mode. Lets non-streaming callers (e.g. an
 * automation skill step) spawn-and-await the same command AgentRunner streams.
 */
export function headlessArgv(params: AgentRunParams): string[] | null {
  const build = HEADLESS_ARGV[params.backend];
  return build ? build(params) : null;
}

export class HeadlessUnsupportedError extends Error {
  readonly backend: string;
  constructor(backend: string) {
    super(`headless run not supported for backend "${backend}" — use the terminal surface`);
    this.name = "HeadlessUnsupportedError";
    this.backend = backend;
  }
}

export interface AgentRunnerOptions {
  spawn?: Spawner;
  notifier?: Notifier;
  ids?: IdProvider;
}

interface RunEntry {
  proc: ManagedProc;
  workspaceId: string;
}

export class AgentRunner {
  private runs = new Map<string, RunEntry>();
  private spawner: Spawner;
  private notifier: Notifier;
  private ids: IdProvider;

  constructor(opts: AgentRunnerOptions = {}) {
    this.spawner = opts.spawn ?? defaultSpawner;
    this.notifier = opts.notifier ?? stdoutNotifier;
    this.ids = opts.ids ?? defaultIds;
  }

  run(params: AgentRunParams): { agentId: string } {
    const build = HEADLESS_ARGV[params.backend];
    if (!build) throw new HeadlessUnsupportedError(params.backend);
    const argv = build(params);
    const agentId = this.ids.uuid("agent");
    const proc = this.spawner(argv, { cwd: params.cwd, env: params.env });
    this.runs.set(agentId, { proc, workspaceId: params.workspaceId });
    // print mode reads the prompt from stdin until EOF — write then close.
    if (proc.stdin) {
      void Promise.resolve(proc.stdin.write(params.prompt))
        .then(() => (proc.stdin as { end?: () => unknown }).end?.())
        .catch(() => {});
    }
    void this.pump(agentId, params.workspaceId, proc);
    return { agentId };
  }

  kill(params: { agentId: string }): { ok: true } {
    const entry = this.runs.get(params.agentId);
    if (!entry) return { ok: true };
    try {
      entry.proc.kill();
    } catch {
      /* already exited */
    }
    this.runs.delete(params.agentId);
    return { ok: true };
  }

  /** Kill every run for a workspace — wired into workspace.destroy so a background agent can't leak. */
  killWorkspace(workspaceId: string): void {
    for (const [agentId, entry] of this.runs) {
      if (entry.workspaceId === workspaceId) this.kill({ agentId });
    }
  }

  has(agentId: string): boolean {
    return this.runs.has(agentId);
  }

  size(): number {
    return this.runs.size;
  }

  private async pump(agentId: string, workspaceId: string, proc: ManagedProc): Promise<void> {
    const streams: Promise<void>[] = [];
    if (proc.stdout) streams.push(this.pumpStream(agentId, workspaceId, proc.stdout, "stdout"));
    // stderr is streamed too — a failing CLI writes there, and swallowing it
    // would make every failure look like an empty Agent Output panel.
    if (proc.stderr) streams.push(this.pumpStream(agentId, workspaceId, proc.stderr, "stderr"));
    await Promise.all(streams);
    const code = await proc.exited.catch(() => proc.exitCode ?? 0);
    emit(this.notifier, "agent.exit", { agentId, workspaceId, code });
    this.runs.delete(agentId);
  }

  private async pumpStream(
    agentId: string,
    workspaceId: string,
    stream: ReadableStream<Uint8Array>,
    kind: "stdout" | "stderr"
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        emit(this.notifier, "agent.data", { agentId, workspaceId, stream: kind, data: decoder.decode(value) });
      }
    } catch (err) {
      emit(this.notifier, "agent.error", {
        agentId,
        workspaceId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
