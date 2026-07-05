import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SQLiteStore } from "../sqlite-store";
import type {
  AgentCapabilities, AgentEvent, AgentPart, AgentRunStatus, AgentSessionSnapshot,
  IdProvider, Notifier, QueuedMessage,
} from "../types";
import { defaultIds, emit } from "../deps";
import { defaultSpawner, type ManagedProc, type Spawner } from "../process-manager";
import { adapterFor, type AgentProviderAdapter, type TurnContext } from "./provider";
import { CheckpointManager } from "./checkpoints";
import { forkSessionFile, sessionFileLineCount } from "./claude-session-file";

// A chatty CLI can fill the OS pipe buffer (~64KB) if stderr is never drained,
// deadlocking the child on write(2). Only a tail is kept — enough for a useful
// error message without unbounded memory growth on a long-running session.
const STDERR_TAIL_BYTES = 8192;

const PATH_SEGMENT_UNSAFE = /[^a-zA-Z0-9._-]+/g;

function sanitizePathSegment(segment: string): string {
  return segment.replace(PATH_SEGMENT_UNSAFE, "-").replace(/^[-.]+/, "") || "x";
}

/**
 * Merges the terminal fields a tool_result carries (status/output/durationMs/
 * fileChanges) onto the tool-call part recorded when the tool_use block first
 * streamed in. The adapter reports blank toolName/title on part-end since only
 * the original tool_use block carries them — mirrors the frontend's
 * src/state/agent-store.ts mergeToolPart so persisted rows match what renders.
 */
function mergeToolPart(existing: AgentPart, incoming: AgentPart): AgentPart {
  if (existing.type !== "tool-call" || incoming.type !== "tool-call") return incoming;
  return {
    ...existing,
    status: incoming.status,
    ...(incoming.output !== undefined ? { output: incoming.output } : {}),
    ...(incoming.durationMs !== undefined ? { durationMs: incoming.durationMs } : {}),
    ...(incoming.fileChanges !== undefined ? { fileChanges: incoming.fileChanges } : {}),
  };
}

interface LiveSession {
  sessionId: string;
  workspaceId: string;
  worktreePath: string;
  backend: string;
  adapter: AgentProviderAdapter;
  proc: ManagedProc | null;
  status: AgentRunStatus;
  queue: QueuedMessage[];
  ctx: TurnContext | null;
  needsRespawn: boolean;
  generation: number; // guards stale read-loops after respawn
  stderrTail: string;
  // messageId -> persisted parts array for the in-flight turn, so a later
  // part-end (tool_result arrives after the owning message closed) can patch
  // the row already written to SQLite instead of leaving it stuck "running".
  turnParts: Map<string, AgentPart[]>;
  interruptTimer: ReturnType<typeof setTimeout> | null;
}

export interface AgentSessionManagerOptions {
  store: SQLiteStore;
  notifier: Notifier;
  spawn?: Spawner;
  checkpoints?: CheckpointManager;
  ids?: IdProvider;
  attachmentsRoot?: string;
  /** Grace period before escalating an unanswered interrupt. Defaults to 3000ms. */
  interruptGraceMs?: number;
}

export class AgentSessionManager {
  private store: SQLiteStore;
  private notifier: Notifier;
  private spawn: Spawner;
  private checkpoints: CheckpointManager;
  private ids: IdProvider;
  private attachmentsRoot: string;
  private interruptGraceMs: number;
  private live = new Map<string, LiveSession>();

  constructor(opts: AgentSessionManagerOptions) {
    this.store = opts.store;
    this.notifier = opts.notifier;
    this.spawn = opts.spawn ?? defaultSpawner;
    this.checkpoints = opts.checkpoints ?? new CheckpointManager();
    this.ids = opts.ids ?? defaultIds;
    this.attachmentsRoot = opts.attachmentsRoot ?? join(homedir(), ".maverick", "attachments");
    this.interruptGraceMs = opts.interruptGraceMs ?? 3000;
  }

  private emitEvent(s: Pick<LiveSession, "workspaceId" | "sessionId">, event: AgentEvent): void {
    emit(this.notifier, "agent.event", { workspaceId: s.workspaceId, sessionId: s.sessionId, event });
  }

  private resolve(sessionId: string): LiveSession {
    const existing = this.live.get(sessionId);
    if (existing) return existing;
    const meta = this.store.sessionMetaGet(sessionId);
    if (!meta) throw new Error(`session ${sessionId} not found`);
    const ws = this.store.workspaceGet(meta.workspaceId);
    if (!ws) throw new Error(`workspace ${meta.workspaceId} not found`);
    const s: LiveSession = {
      sessionId,
      workspaceId: ws.id,
      worktreePath: ws.worktreePath,
      backend: ws.agentBackend,
      adapter: adapterFor(ws.agentBackend),
      proc: null,
      status: "idle",
      queue: [],
      ctx: null,
      needsRespawn: false,
      generation: 0,
      stderrTail: "",
      turnParts: new Map(),
      interruptTimer: null,
    };
    this.live.set(sessionId, s);
    return s;
  }

  capabilities(workspaceId: string): AgentCapabilities {
    const ws = this.store.workspaceGet(workspaceId);
    if (!ws) throw new Error(`workspace ${workspaceId} not found`);
    return adapterFor(ws.agentBackend).capabilities(ws.worktreePath);
  }

  state(workspaceId: string): AgentSessionSnapshot {
    const ws = this.store.workspaceGet(workspaceId);
    if (!ws) throw new Error(`workspace ${workspaceId} not found`);
    const meta = this.store.sessionMetaGet(ws.sessionId);
    const liveState = this.live.get(ws.sessionId);
    return {
      sessionId: ws.sessionId,
      workspaceId,
      status: liveState?.status ?? "idle",
      queue: liveState?.queue ?? [],
      model: meta?.model ?? null,
      reasoningLevel: meta?.reasoningLevel ?? null,
      providerSessionId: meta?.providerSessionId ?? null,
    };
  }

  async send(sessionId: string, parts: AgentPart[]): Promise<{ queued: boolean; turnId?: string }> {
    const s = this.resolve(sessionId);
    if (s.status === "working") {
      const queued: QueuedMessage = { id: this.ids.uuid("q"), parts, createdAt: this.ids.now() };
      s.queue.push(queued);
      this.emitEvent(s, { type: "queue-updated", queue: [...s.queue] });
      return { queued: true };
    }
    const turnId = await this.startTurn(s, parts);
    return { queued: false, turnId };
  }

  private async startTurn(s: LiveSession, parts: AgentPart[]): Promise<string> {
    const turnId = this.ids.uuid("turn");
    const userMessageId = this.ids.uuid("umsg");
    const createdAt = this.ids.now();
    const meta = this.store.sessionMetaGet(s.sessionId);

    let gitSha = "";
    try {
      gitSha = await this.checkpoints.snapshot(s.worktreePath, s.sessionId);
    } catch (e) {
      // A checkpoint failure must not block the send — rewind for this turn is simply unavailable.
      console.error("[agent] checkpoint snapshot failed:", e);
    }
    if (gitSha) {
      this.store.checkpointCreate({
        id: this.ids.uuid("cp"),
        sessionId: s.sessionId,
        messageId: userMessageId,
        gitSha,
        providerSessionId: meta?.providerSessionId ?? null,
        providerLineCount: meta?.providerSessionId
          ? sessionFileLineCount(s.worktreePath, meta.providerSessionId)
          : 0,
        createdAt,
      });
    }

    const userMessage = {
      id: userMessageId,
      sessionId: s.sessionId,
      turnId,
      role: "user" as const,
      parts,
      createdAt,
    };
    this.store.agentMessageAppend({
      id: userMessageId,
      sessionId: s.sessionId,
      role: "user",
      content: parts.map((p) => (p.type === "text" ? p.text : "")).join("\n"),
      partsJson: JSON.stringify(parts),
      turnId,
      createdAt,
    });
    this.emitEvent(s, { type: "message-start", message: userMessage });
    this.emitEvent(s, { type: "message-end", message: userMessage });

    this.ensureProc(s);
    s.ctx = {
      sessionId: s.sessionId,
      turnId,
      ids: this.ids,
      current: null,
      tools: new Map(),
      unknownLines: 0,
    };
    s.turnParts = new Map();
    try {
      s.proc!.stdin!.write(s.adapter.encodeUserMessage(parts) + "\n");
      this.setStatus(s, "working");
    } catch (e) {
      // The user message is already persisted — the error event is the caller's
      // signal, so the send itself must not reject.
      s.needsRespawn = true;
      this.emitEvent(s, { type: "error", message: `failed to write to agent stdin: ${String(e)}`, recoverable: true });
      this.setStatus(s, "error");
    }
    return turnId;
  }

  private ensureProc(s: LiveSession): void {
    if (s.proc && s.proc.exitCode === null && !s.needsRespawn) return;
    if (s.proc && s.proc.exitCode === null) {
      try { s.proc.kill(); } catch { /* already gone */ }
    }
    const meta = this.store.sessionMetaGet(s.sessionId);
    const cmd = s.adapter.buildSpawn({
      worktreePath: s.worktreePath,
      model: meta?.model ?? null,
      reasoningLevel: meta?.reasoningLevel ?? null,
      resumeSessionId: meta?.providerSessionId ?? null,
    });
    s.proc = this.spawn(cmd, { cwd: s.worktreePath });
    s.stderrTail = "";
    s.needsRespawn = false;
    s.generation += 1;
    void this.readLoop(s, s.proc, s.generation);
    void this.drainStderr(s, s.proc, s.generation);
  }

  // Left undrained, a chatty CLI fills the pipe buffer and deadlocks on write —
  // this keeps only a bounded tail for diagnostics, no upstream consumer needs it.
  private async drainStderr(s: LiveSession, proc: ManagedProc, generation: number): Promise<void> {
    if (!proc.stderr) return;
    const decoder = new TextDecoder();
    try {
      for await (const chunk of proc.stderr) {
        if (s.generation !== generation) return;
        s.stderrTail = (s.stderrTail + decoder.decode(chunk, { stream: true })).slice(-STDERR_TAIL_BYTES);
      }
    } catch (e) {
      console.error("[agent] stderr read failed:", e);
    }
  }

  private async readLoop(s: LiveSession, proc: ManagedProc, generation: number): Promise<void> {
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of proc.stdout!) {
        if (s.generation !== generation) return;
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) this.handleLine(s, line);
        }
      }
    } catch (e) {
      console.error("[agent] stdout read failed:", e);
    }
    const code = await proc.exited;
    if (s.generation !== generation) return;
    s.proc = null;
    this.clearInterruptTimer(s);
    if (s.status === "working") {
      const tail = s.stderrTail.trim();
      const message = tail
        ? `agent process exited with code ${code}\n${tail}`
        : `agent process exited with code ${code}`;
      this.emitEvent(s, { type: "error", message, recoverable: true });
      this.setStatus(s, "error");
    }
  }

  private handleLine(s: LiveSession, line: string): void {
    if (!s.ctx) return;
    const events = s.adapter.translate(line, s.ctx);
    for (const event of events) {
      switch (event.type) {
        case "session-meta":
          this.store.sessionMetaSet(s.sessionId, { providerSessionId: event.providerSessionId });
          break;
        case "message-end":
          if (event.message.role === "assistant") {
            this.store.agentMessageAppend({
              id: event.message.id,
              sessionId: s.sessionId,
              role: "assistant",
              content: event.message.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n"),
              partsJson: JSON.stringify(event.message.parts),
              turnId: event.message.turnId,
              createdAt: event.message.createdAt,
            });
            // tool_result part-end events for this message's tool-calls arrive
            // after this INSERT — track the persisted array so they can patch it.
            s.turnParts.set(event.message.id, event.message.parts);
          }
          break;
        case "part-end": {
          const parts = s.turnParts.get(event.messageId);
          if (parts && parts[event.partIndex] !== undefined) {
            const existing = parts[event.partIndex];
            parts[event.partIndex] =
              existing.type === "tool-call" && event.part.type === "tool-call"
                ? mergeToolPart(existing, event.part)
                : event.part;
            this.store.messagePartsUpdate(event.messageId, JSON.stringify(parts));
          }
          break;
        }
        case "error":
          this.setStatus(s, "error");
          break;
        default:
          break;
      }
      this.emitEvent(s, event);
      if (event.type === "turn-end") this.finishTurn(s);
    }
  }

  private finishTurn(s: LiveSession): void {
    s.ctx = null;
    s.turnParts = new Map();
    // An errored turn must not auto-drain the queue: the next queued message
    // would silently run against a broken provider session. The queue stays
    // intact so the user can remove/resend; a later send drains normally.
    if (s.status === "error") return;
    this.setStatus(s, "idle");
    const next = s.queue.shift();
    if (next) {
      this.emitEvent(s, { type: "queue-updated", queue: [...s.queue] });
      void this.startTurn(s, next.parts).catch((e) => {
        console.error("[agent] queued turn failed to start:", e);
        this.emitEvent(s, { type: "error", message: String(e), recoverable: true });
        this.setStatus(s, "error");
      });
    }
  }

  private setStatus(s: LiveSession, status: AgentRunStatus): void {
    if (s.status === status) return;
    s.status = status;
    // Leaving "working" means the turn resolved on its own — any pending
    // interrupt escalation for it is now moot.
    if (status !== "working") this.clearInterruptTimer(s);
    this.emitEvent(s, { type: "status", status });
  }

  private clearInterruptTimer(s: LiveSession): void {
    if (s.interruptTimer) {
      clearTimeout(s.interruptTimer);
      s.interruptTimer = null;
    }
  }

  // A control-line interrupt is a request, not a guarantee — a wedged CLI may
  // never acknowledge it. Escalates SIGINT then a hard kill if the turn is
  // still "working" after successive grace periods.
  private armInterruptEscalation(s: LiveSession): void {
    this.clearInterruptTimer(s);
    const proc = s.proc;
    if (!proc) return;
    s.interruptTimer = setTimeout(() => {
      s.interruptTimer = null;
      if (s.status !== "working" || s.proc !== proc || proc.exitCode !== null) return;
      try { proc.kill("SIGINT"); } catch { /* already gone */ }
      s.interruptTimer = setTimeout(() => {
        s.interruptTimer = null;
        if (s.status !== "working" || s.proc !== proc || proc.exitCode !== null) return;
        try { proc.kill(); } catch { /* already gone */ }
      }, this.interruptGraceMs);
    }, this.interruptGraceMs);
  }

  async interrupt(sessionId: string): Promise<{ ok: true }> {
    const s = this.resolve(sessionId);
    if (!s.proc || s.proc.exitCode !== null) return { ok: true };
    const line = s.adapter.encodeInterrupt(this.ids.uuid("ctl"));
    try {
      if (line) s.proc.stdin!.write(line + "\n");
      else s.proc.kill("SIGINT");
    } catch (e) {
      s.needsRespawn = true;
      this.emitEvent(s, { type: "error", message: `failed to interrupt agent: ${String(e)}`, recoverable: true });
      this.setStatus(s, "error");
      throw e;
    }
    this.armInterruptEscalation(s);
    return { ok: true };
  }

  queueRemove(sessionId: string, queuedId: string): { ok: true } {
    const s = this.resolve(sessionId);
    s.queue = s.queue.filter((q) => q.id !== queuedId);
    this.emitEvent(s, { type: "queue-updated", queue: [...s.queue] });
    return { ok: true };
  }

  setOptions(sessionId: string, opts: { model?: string; reasoningLevel?: string }): { ok: true } {
    const s = this.resolve(sessionId);
    this.store.sessionMetaSet(sessionId, {
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.reasoningLevel !== undefined ? { reasoningLevel: opts.reasoningLevel } : {}),
    });
    s.needsRespawn = true;
    return { ok: true };
  }

  async rewind(sessionId: string, messageId: string): Promise<{ ok: true }> {
    const s = this.resolve(sessionId);
    const cp = this.store.checkpointByMessage(sessionId, messageId);
    if (!cp) throw new Error(`no checkpoint for message ${messageId}`);
    if (s.proc && s.proc.exitCode === null) {
      s.generation += 1; // detach the read loop before killing
      try { s.proc.kill(); } catch { /* already gone */ }
      s.proc = null;
    }
    this.clearInterruptTimer(s);
    s.ctx = null;
    s.queue = [];
    // Worktree first, DB second: never truncate history if files failed to restore.
    try {
      await this.checkpoints.restore(s.worktreePath, cp.gitSha);
    } catch (e) {
      // Proc is already killed and ctx cleared — idle is the truthful state.
      // History is untouched (truncation only happens below), so the session
      // stays fully usable; the caller sees the rethrow, the UI the event.
      this.emitEvent(s, { type: "error", message: `rewind failed to restore checkpoint: ${String(e)}`, recoverable: true });
      this.setStatus(s, "idle");
      throw e;
    }
    this.store.messagesTruncateFrom(sessionId, messageId);
    this.store.checkpointsTruncateFrom(sessionId, cp.createdAt);
    let providerSessionId: string | null = null;
    if (cp.providerSessionId && cp.providerLineCount > 0) {
      const forkId = crypto.randomUUID();
      if (forkSessionFile(s.worktreePath, cp.providerSessionId, cp.providerLineCount, forkId)) {
        providerSessionId = forkId;
      }
    }
    this.store.sessionMetaSet(sessionId, { providerSessionId });
    s.needsRespawn = true;
    this.setStatus(s, "idle");
    this.emitEvent(s, { type: "queue-updated", queue: [] });
    return { ok: true };
  }

  attachmentSave(sessionId: string, name: string, contentBase64: string): { path: string } {
    // sessionId is caller-supplied via RPC — sanitize it exactly like the file
    // name, or a "../../etc" session id escapes attachmentsRoot entirely.
    const dir = join(this.attachmentsRoot, sanitizePathSegment(sessionId));
    mkdirSync(dir, { recursive: true });
    const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+/, "") || "attachment";
    const path = join(dir, safe);
    writeFileSync(path, Buffer.from(contentBase64, "base64"));
    return { path };
  }

  /**
   * Tears down every live proc for a workspace, then sweeps checkpoint refs for
   * EVERY session the store ever recorded for it — not just the in-memory live
   * ones. A workspace destroyed after an app restart has no live entries at
   * all, so relying on `this.live` alone leaks refs/<sessionId> (and their
   * pinned snapshot commits) into the shared .git forever, racing the worktree
   * removal that follows.
   */
  async disposeForWorkspace(workspaceId: string): Promise<void> {
    for (const [sessionId, s] of this.live) {
      if (s.workspaceId !== workspaceId) continue;
      s.generation += 1;
      this.clearInterruptTimer(s);
      if (s.proc && s.proc.exitCode === null) {
        try { s.proc.kill(); } catch { /* already gone */ }
      }
      this.live.delete(sessionId);
    }
    const ws = this.store.workspaceGet(workspaceId);
    if (!ws) return;
    for (const sessionId of this.store.sessionsForWorkspace(workspaceId)) {
      try {
        await this.checkpoints.dropRef(ws.worktreePath, sessionId);
      } catch {
        // Best-effort per ref — one stuck/missing ref must not block the rest.
      }
    }
  }
}
