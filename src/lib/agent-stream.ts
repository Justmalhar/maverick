// Parses claude's `--output-format stream-json` events into normalized deltas
// for the read-only Agent Output panel and the status pills. Pure + sync so it's
// fully unit-testable; the hook owns buffering + IPC. Event shapes verified by
// the 2026-06-25 headless spike (claude 2.1.173).

export type AgentDelta =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: string; summary: string }
  | { kind: "session"; sessionId: string }
  | { kind: "result"; text: string; sessionId?: string; costUsd?: number; isError: boolean }
  | { kind: "stderr"; text: string };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

// One-line summary of a tool call for the panel, e.g. "Edit src/app.ts" or
// "Bash npm test". Falls back to just the tool name when no obvious target.
function summarizeTool(name: string, input: unknown): string {
  const i = asRecord(input);
  const target =
    (i?.file_path as string) ??
    (i?.path as string) ??
    (i?.command as string) ??
    (i?.pattern as string) ??
    "";
  const short = typeof target === "string" ? target.split(/[\\/]/).slice(-2).join("/") : "";
  return short ? `${name} ${short}` : name;
}

/** Normalize one parsed stream-json object into zero or more panel/status deltas. */
export function parseAgentEvent(obj: unknown): AgentDelta[] {
  const e = asRecord(obj);
  if (!e) return [];
  const type = e.type;

  if (type === "system") {
    const sid = e.session_id;
    if (e.subtype === "init" && typeof sid === "string") return [{ kind: "session", sessionId: sid }];
    return [];
  }

  if (type === "assistant") {
    const msg = asRecord(e.message);
    const content = Array.isArray(msg?.content) ? (msg!.content as unknown[]) : [];
    const out: AgentDelta[] = [];
    for (const raw of content) {
      const item = asRecord(raw);
      if (!item) continue;
      if (item.type === "text" && typeof item.text === "string" && item.text.trim() !== "") {
        out.push({ kind: "text", text: item.text });
      } else if (item.type === "tool_use" && typeof item.name === "string") {
        out.push({ kind: "tool", tool: item.name, summary: summarizeTool(item.name, item.input) });
      }
    }
    return out;
  }

  if (type === "result") {
    const delta: Extract<AgentDelta, { kind: "result" }> = {
      kind: "result",
      text: typeof e.result === "string" ? e.result : "",
      isError: e.is_error === true,
    };
    if (typeof e.session_id === "string") delta.sessionId = e.session_id;
    if (typeof e.total_cost_usd === "number") delta.costUsd = e.total_cost_usd;
    return [delta];
  }

  return [];
}

/** Parse a raw stdout chunk (possibly several newline-delimited JSON lines) into deltas. */
export function parseAgentChunk(chunk: string): AgentDelta[] {
  const out: AgentDelta[] = [];
  for (const line of chunk.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(...parseAgentEvent(JSON.parse(trimmed)));
    } catch {
      // A partial/non-JSON line — skip; the LineBuffer keeps incomplete tails.
    }
  }
  return out;
}

// Accumulates streamed bytes and yields only COMPLETE newline-delimited lines,
// holding any partial tail until the rest arrives (stream chunks split mid-line).
export class LineBuffer {
  private buf = "";

  push(chunk: string): string[] {
    this.buf += chunk;
    const parts = this.buf.split("\n");
    this.buf = parts.pop() ?? "";
    return parts.map((l) => l.trim()).filter((l) => l !== "");
  }

  /** Any buffered tail (call on stream end). */
  flush(): string {
    const rest = this.buf.trim();
    this.buf = "";
    return rest;
  }
}
