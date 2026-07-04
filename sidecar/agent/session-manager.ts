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
}

export interface AgentSessionManagerOptions {
  store: SQLiteStore;
  notifier: Notifier;
  spawn?: Spawner;
  checkpoints?: CheckpointManager;
  ids?: IdProvider;
  attachmentsRoot?: string;
}

export class AgentSessionManager {
  private store: SQLiteStore;
  private notifier: Notifier;
  private spawn: Spawner;
  private checkpoints: CheckpointManager;
  private ids: IdProvider;
  private attachmentsRoot: string;
  private live = new Map<string, LiveSession>();

  constructor(opts: AgentSessionManagerOptions) {
    this.store = opts.store;
    this.notifier = opts.notifier;
    this.spawn = opts.spawn ?? defaultSpawner;
    this.checkpoints = opts.checkpoints ?? new CheckpointManager();
    this.ids = opts.ids ?? defaultIds;
    this.attachmentsRoot = opts.attachmentsRoot ?? join(homedir(), ".maverick", "attachments");
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
    s.needsRespawn = false;
    s.generation += 1;
    void this.readLoop(s, s.proc, s.generation);
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
    if (s.status === "working") {
      this.emitEvent(s, { type: "error", message: `agent process exited with code ${code}`, recoverable: true });
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
          }
          break;
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
    this.emitEvent(s, { type: "status", status });
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
    const dir = join(this.attachmentsRoot, sessionId);
    mkdirSync(dir, { recursive: true });
    const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+/, "") || "attachment";
    const path = join(dir, safe);
    writeFileSync(path, Buffer.from(contentBase64, "base64"));
    return { path };
  }

  disposeForWorkspace(workspaceId: string): void {
    for (const [sessionId, s] of this.live) {
      if (s.workspaceId !== workspaceId) continue;
      s.generation += 1;
      if (s.proc && s.proc.exitCode === null) {
        try { s.proc.kill(); } catch { /* already gone */ }
      }
      void this.checkpoints.dropRef(s.worktreePath, sessionId).catch(() => {});
      this.live.delete(sessionId);
    }
  }
}
