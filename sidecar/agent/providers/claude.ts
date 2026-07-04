import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentCapabilities, AgentEvent, AgentFileChange, AgentPart, AgentSlashCommand } from "../../types";
import type { AgentProviderAdapter, SpawnOpts, TurnContext } from "../provider";

const MAX_TOOL_OUTPUT = 4000;

const MODELS = [
  { id: "default", label: "Default" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const REASONING = [
  { id: "default", label: "Default" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

function scanSlashCommands(dir: string): AgentSlashCommand[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const name = `/${f.replace(/\.md$/, "")}`;
        let description = "";
        try {
          const first = readFileSync(join(dir, f), "utf8").split("\n").find((l) => l.trim() !== "") ?? "";
          description = first.replace(/^#+\s*/, "").slice(0, 120);
        } catch {
          /* unreadable command file — list it without a description */
        }
        return { name, description };
      });
  } catch {
    return [];
  }
}

function countLines(s: string | undefined): number {
  if (!s) return 0;
  return s.split("\n").length;
}

function fileChangesFor(toolName: string, input: Record<string, unknown>): { fileChanges?: AgentFileChange[] } {
  const path = typeof input.file_path === "string" ? input.file_path : undefined;
  if (!path) return {};
  if (toolName === "Write") {
    return { fileChanges: [{ path, additions: countLines(input.content as string), deletions: 0, kind: "create" }] };
  }
  if (toolName === "Edit" || toolName === "MultiEdit") {
    const edits = Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : [input];
    let additions = 0;
    let deletions = 0;
    for (const e of edits) {
      additions += countLines(e.new_string as string);
      deletions += countLines(e.old_string as string);
    }
    return { fileChanges: [{ path, additions, deletions, kind: "edit" }] };
  }
  return {};
}

function toolTitle(name: string, input: Record<string, unknown>): { title: string; detail?: string } {
  if (typeof input.description === "string" && input.description) {
    return { title: input.description, detail: typeof input.command === "string" ? input.command : undefined };
  }
  if (typeof input.command === "string") return { title: name, detail: input.command };
  if (typeof input.file_path === "string") return { title: name, detail: input.file_path };
  if (typeof input.pattern === "string") return { title: name, detail: input.pattern };
  return { title: name };
}

function toolCallPart(block: { id: string; name: string; input?: Record<string, unknown> }): AgentPart {
  const input = block.input ?? {};
  const { title, detail } = toolTitle(block.name, input);
  return {
    type: "tool-call",
    toolUseId: block.id,
    toolName: block.name,
    title,
    ...(detail !== undefined ? { detail } : {}),
    status: "running",
    ...fileChangesFor(block.name, input),
  };
}

function openMessage(ctx: TurnContext): AgentEvent[] {
  const messageId = ctx.ids.uuid("amsg");
  ctx.current = { messageId, parts: [] };
  return [
    {
      type: "message-start",
      message: { id: messageId, sessionId: ctx.sessionId, turnId: ctx.turnId, role: "assistant", parts: [], createdAt: ctx.ids.now() },
    },
  ];
}

function closeMessage(ctx: TurnContext): AgentEvent[] {
  if (!ctx.current) return [];
  const { messageId, parts } = ctx.current;
  ctx.current = null;
  return [
    {
      type: "message-end",
      message: { id: messageId, sessionId: ctx.sessionId, turnId: ctx.turnId, role: "assistant", parts, createdAt: ctx.ids.now() },
    },
  ];
}

function textFromResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && (c as { type?: string }).type === "text" ? (c as { text?: string }).text ?? "" : ""))
      .join("\n");
  }
  return "";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function translateStreamEvent(ev: any, ctx: TurnContext): AgentEvent[] {
  switch (ev?.type) {
    case "message_start":
      return openMessage(ctx);
    case "content_block_start": {
      if (!ctx.current) return [];
      const block = ev.content_block ?? {};
      let part: AgentPart | null = null;
      if (block.type === "text") part = { type: "text", text: block.text ?? "" };
      else if (block.type === "thinking") part = { type: "thinking", summary: block.thinking ?? "" };
      else return []; // tool_use arrives authoritatively via the complete assistant message
      const partIndex = ctx.current.parts.length;
      ctx.current.parts.push(part);
      return [{ type: "part-start", messageId: ctx.current.messageId, partIndex, part }];
    }
    case "content_block_delta": {
      if (!ctx.current || ctx.current.parts.length === 0) return [];
      const partIndex = ctx.current.parts.length - 1;
      const part = ctx.current.parts[partIndex];
      const d = ev.delta ?? {};
      let delta = "";
      if (d.type === "text_delta" && part.type === "text") {
        delta = d.text ?? "";
        part.text += delta;
      } else if (d.type === "thinking_delta" && part.type === "thinking") {
        delta = d.thinking ?? "";
        part.summary += delta;
      } else {
        return [];
      }
      if (delta === "") return [];
      return [{ type: "part-delta", messageId: ctx.current.messageId, partIndex, delta }];
    }
    default:
      return [];
  }
}

function reconcileAssistant(raw: any, ctx: TurnContext): AgentEvent[] {
  const events: AgentEvent[] = [];
  if (!ctx.current) events.push(...openMessage(ctx));
  const cur = ctx.current!;
  const content: any[] = Array.isArray(raw?.message?.content) ? raw.message.content : [];
  const reconciled: AgentPart[] = [];
  for (const block of content) {
    if (block.type === "text") reconciled.push({ type: "text", text: block.text ?? "" });
    else if (block.type === "thinking") reconciled.push({ type: "thinking", summary: block.thinking ?? "" });
    else if (block.type === "tool_use") {
      const part = toolCallPart(block);
      const partIndex = reconciled.length;
      ctx.tools.set(block.id, { messageId: cur.messageId, partIndex, startedAt: ctx.ids.now() });
      events.push({ type: "part-start", messageId: cur.messageId, partIndex, part });
      reconciled.push(part);
    }
  }
  cur.parts = reconciled;
  events.push(...closeMessage(ctx));
  return events;
}

function translateToolResults(raw: any, ctx: TurnContext): AgentEvent[] {
  const events: AgentEvent[] = [];
  const content: any[] = Array.isArray(raw?.message?.content) ? raw.message.content : [];
  for (const block of content) {
    if (block.type !== "tool_result") continue;
    const loc = ctx.tools.get(block.tool_use_id);
    if (!loc) continue;
    ctx.tools.delete(block.tool_use_id);
    const output = textFromResultContent(block.content).slice(0, MAX_TOOL_OUTPUT);
    events.push({
      type: "part-end",
      messageId: loc.messageId,
      partIndex: loc.partIndex,
      part: {
        // The session manager patches the persisted part; the adapter reports the terminal fields.
        type: "tool-call",
        toolUseId: block.tool_use_id,
        toolName: "",
        title: "",
        status: block.is_error ? "error" : "ok",
        output,
        durationMs: ctx.ids.now() - loc.startedAt,
      },
    });
  }
  return events;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const claudeAdapter: AgentProviderAdapter = {
  id: "claude",

  capabilities(worktreePath: string): AgentCapabilities {
    return {
      models: MODELS,
      reasoningLevels: REASONING,
      slashCommands: [
        { name: "/compact", description: "Compact the conversation context" },
        ...scanSlashCommands(join(homedir(), ".claude", "commands")),
        ...scanSlashCommands(join(worktreePath, ".claude", "commands")),
      ],
      supportsInterrupt: true,
      supportsConversationRewind: true,
    };
  },

  buildSpawn(opts: SpawnOpts): string[] {
    const cmd = [
      "claude",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode", "bypassPermissions",
      "--max-turns", "1000",
    ];
    if (opts.model && opts.model !== "default") cmd.push("--model", opts.model);
    if (opts.reasoningLevel && opts.reasoningLevel !== "default") cmd.push("--effort", opts.reasoningLevel);
    if (opts.resumeSessionId) cmd.push("--resume", opts.resumeSessionId);
    return cmd;
  },

  encodeUserMessage(parts: AgentPart[]): string {
    const text = parts
      .map((p) => {
        if (p.type === "text") return p.text;
        if (p.type === "attachment") return `[Attached file: ${p.path}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
    return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
  },

  encodeInterrupt(requestId: string): string | null {
    return JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "interrupt" } });
  },

  translate(line: string, ctx: TurnContext): AgentEvent[] {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      ctx.unknownLines += 1;
      return [];
    }
    switch (raw.type) {
      case "system": {
        if (raw.subtype !== "init") return [];
        return [{ type: "session-meta", providerSessionId: String(raw.session_id ?? ""), model: String(raw.model ?? "") }];
      }
      case "stream_event":
        return translateStreamEvent((raw as { event?: unknown }).event, ctx);
      case "assistant":
        return reconcileAssistant(raw, ctx);
      case "user":
        return translateToolResults(raw, ctx);
      case "result": {
        const events: AgentEvent[] = [...closeMessage(ctx)];
        if (raw.is_error) {
          events.push({ type: "error", message: String((raw as { result?: unknown }).result ?? "agent run failed"), recoverable: true });
        }
        const usage = (raw.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
        events.push({
          type: "turn-end",
          turnId: ctx.turnId,
          usage: {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            ...(typeof raw.total_cost_usd === "number" ? { costUsd: raw.total_cost_usd } : {}),
            durationMs: typeof raw.duration_ms === "number" ? raw.duration_ms : 0,
          },
        });
        return events;
      }
      case "control_response":
      case "control_request":
      // Quota telemetry emitted by claude >= 2.1.201 — benign, never a mapping gap.
      case "rate_limit_event":
        return [];
      default:
        ctx.unknownLines += 1;
        return [];
    }
  },
};
