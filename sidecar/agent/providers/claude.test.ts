import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { claudeAdapter } from "./claude";
import { adapterFor } from "../provider";
import type { AgentEvent } from "../../types";
import type { TurnContext } from "../provider";

function ctx(): TurnContext {
  let n = 0;
  return {
    sessionId: "sess1",
    turnId: "turn1",
    ids: { uuid: (p) => `${p}_${++n}`, now: () => 1000 + n },
    current: null,
    tools: new Map(),
    unknownLines: 0,
  };
}

const INIT = JSON.stringify({ type: "system", subtype: "init", session_id: "prov-abc", model: "claude-sonnet-4-6", tools: [], cwd: "/w" });
const MSG_START = JSON.stringify({ type: "stream_event", event: { type: "message_start", message: { id: "msg_1", role: "assistant", content: [] } }, session_id: "prov-abc" });
const TEXT_START = JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, session_id: "prov-abc" });
const TEXT_DELTA = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }, session_id: "prov-abc" });
const THINK_START = JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }, session_id: "prov-abc" });
const THINK_DELTA = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering" } }, session_id: "prov-abc" });
const ASSISTANT_TOOL = JSON.stringify({
  type: "assistant",
  message: { id: "msg_1", role: "assistant", model: "claude-sonnet-4-6", content: [
    { type: "text", text: "Hello" },
    { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls -la", description: "List files" } },
  ] },
  session_id: "prov-abc",
});
const TOOL_RESULT = JSON.stringify({
  type: "user",
  message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "file-a\nfile-b" }], is_error: false },
  ] },
  session_id: "prov-abc",
});
const EDIT_TOOL = JSON.stringify({
  type: "assistant",
  message: { id: "msg_2", role: "assistant", content: [
    { type: "tool_use", id: "toolu_2", name: "Edit", input: { file_path: "/w/src/a.ts", old_string: "aaa\nbbb", new_string: "aaa\nccc\nddd" } },
  ] },
  session_id: "prov-abc",
});
const RESULT = JSON.stringify({
  type: "result", subtype: "success", is_error: false, duration_ms: 1234, num_turns: 2,
  result: "Done.", session_id: "prov-abc", total_cost_usd: 0.05,
  usage: { input_tokens: 10, output_tokens: 20 },
});

describe("claudeAdapter.translate", () => {
  test("init → session-meta", () => {
    const evts = claudeAdapter.translate(INIT, ctx());
    expect(evts).toEqual([{ type: "session-meta", providerSessionId: "prov-abc", model: "claude-sonnet-4-6" }]);
  });

  test("text stream: message-start, part-start, part-delta", () => {
    const c = ctx();
    expect(claudeAdapter.translate(MSG_START, c).map((e) => e.type)).toEqual(["message-start"]);
    expect(claudeAdapter.translate(TEXT_START, c).map((e) => e.type)).toEqual(["part-start"]);
    const deltas = claudeAdapter.translate(TEXT_DELTA, c);
    expect(deltas).toEqual([{ type: "part-delta", messageId: c.current!.messageId, partIndex: 0, delta: "Hello" }]);
    expect(c.current!.parts[0]).toEqual({ type: "text", text: "Hello" });
  });

  test("thinking stream accumulates into summary", () => {
    const c = ctx();
    claudeAdapter.translate(MSG_START, c);
    claudeAdapter.translate(THINK_START, c);
    claudeAdapter.translate(THINK_DELTA, c);
    expect(c.current!.parts[0]).toEqual({ type: "thinking", summary: "pondering" });
  });

  test("complete assistant message reconciles text + emits running tool-call, message-end", () => {
    const c = ctx();
    claudeAdapter.translate(MSG_START, c);
    claudeAdapter.translate(TEXT_START, c);
    claudeAdapter.translate(TEXT_DELTA, c);
    const evts = claudeAdapter.translate(ASSISTANT_TOOL, c);
    const types = evts.map((e) => e.type);
    expect(types).toContain("part-start");
    expect(types[types.length - 1]).toBe("message-end");
    const end = evts.at(-1) as Extract<ReturnType<typeof claudeAdapter.translate>[number], { type: "message-end" }>;
    expect(end.message.parts).toEqual([
      { type: "text", text: "Hello" },
      { type: "tool-call", toolUseId: "toolu_1", toolName: "Bash", title: "List files", detail: "ls -la", status: "running" },
    ]);
    expect(c.tools.get("toolu_1")).toBeDefined();
    expect(c.current).toBeNull();
  });

  test("tool_result → part-end ok with truncated output", () => {
    const c = ctx();
    claudeAdapter.translate(MSG_START, c);
    claudeAdapter.translate(ASSISTANT_TOOL, c);
    const evts = claudeAdapter.translate(TOOL_RESULT, c);
    expect(evts).toHaveLength(1);
    const e = evts[0] as Extract<(typeof evts)[number], { type: "part-end" }>;
    expect(e.type).toBe("part-end");
    expect(e.part).toMatchObject({ type: "tool-call", toolUseId: "toolu_1", status: "ok", output: "file-a\nfile-b" });
  });

  test("Edit tool input yields fileChanges with +/- counts", () => {
    const c = ctx();
    claudeAdapter.translate(MSG_START, c);
    const evts = claudeAdapter.translate(EDIT_TOOL, c);
    const end = evts.at(-1) as { type: "message-end"; message: { parts: unknown[] } };
    expect(end.message.parts[0]).toMatchObject({
      type: "tool-call",
      toolName: "Edit",
      fileChanges: [{ path: "/w/src/a.ts", additions: 3, deletions: 2, kind: "edit" }],
    });
  });

  test("Write tool input yields a create fileChange sized by content lines", () => {
    const c = ctx();
    const line = JSON.stringify({
      type: "assistant",
      message: { id: "msg_3", role: "assistant", content: [
        { type: "tool_use", id: "toolu_3", name: "Write", input: { file_path: "/w/new.ts", content: "a\nb\nc" } },
      ] },
      session_id: "prov-abc",
    });
    const evts = claudeAdapter.translate(line, c);
    const end = evts.at(-1) as { type: "message-end"; message: { parts: unknown[] } };
    expect(end.message.parts[0]).toMatchObject({
      type: "tool-call",
      toolName: "Write",
      title: "Write",
      detail: "/w/new.ts",
      status: "running",
      fileChanges: [{ path: "/w/new.ts", additions: 3, deletions: 0, kind: "create" }],
    });
  });

  test("MultiEdit tool input sums additions/deletions across edits", () => {
    const c = ctx();
    const line = JSON.stringify({
      type: "assistant",
      message: { id: "msg_4", role: "assistant", content: [
        { type: "tool_use", id: "toolu_4", name: "MultiEdit", input: {
          file_path: "/w/m.ts",
          edits: [
            { old_string: "a", new_string: "a\nb" },
            { old_string: "x\ny", new_string: "z" },
          ],
        } },
      ] },
      session_id: "prov-abc",
    });
    const evts = claudeAdapter.translate(line, c);
    const end = evts.at(-1) as { type: "message-end"; message: { parts: unknown[] } };
    expect(end.message.parts[0]).toMatchObject({
      type: "tool-call",
      toolName: "MultiEdit",
      fileChanges: [{ path: "/w/m.ts", additions: 3, deletions: 3, kind: "edit" }],
    });
  });

  test("result → turn-end with usage", () => {
    const evts = claudeAdapter.translate(RESULT, ctx());
    expect(evts).toEqual([
      { type: "turn-end", turnId: "turn1", usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.05, durationMs: 1234 } },
    ]);
  });

  test("result with is_error → error + turn-end", () => {
    const errLine = JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, duration_ms: 5, result: "boom", session_id: "prov-abc", usage: { input_tokens: 1, output_tokens: 1 } });
    const types = claudeAdapter.translate(errLine, ctx()).map((e) => e.type);
    expect(types).toEqual(["error", "turn-end"]);
  });

  test("junk / unknown lines emit nothing and count as unknown; a later result line reports the count", () => {
    const c = ctx();
    expect(claudeAdapter.translate("not json at all", c)).toEqual([]);
    expect(claudeAdapter.translate(JSON.stringify({ type: "mystery_v9" }), c)).toEqual([]);
    expect(c.unknownLines).toBe(2);
    const evts = claudeAdapter.translate(RESULT, c);
    expect(evts).toEqual([
      { type: "turn-end", turnId: "turn1", usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.05, durationMs: 1234 }, unknownLines: 2 },
    ]);
  });
});

describe("claudeAdapter encode/build", () => {
  test("encodeUserMessage renders text + attachment path refs", () => {
    const line = claudeAdapter.encodeUserMessage([
      { type: "text", text: "review this" },
      { type: "attachment", name: "shot.png", path: "/tmp/shot.png", mime: "image/png" },
    ]);
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe("user");
    expect(parsed.message.role).toBe("user");
    expect(parsed.message.content[0]).toEqual({ type: "text", text: "review this\n\n[Attached file: /tmp/shot.png]" });
  });

  test("buildSpawn composes flags and omits defaults", () => {
    const cmd = claudeAdapter.buildSpawn({ worktreePath: "/w", model: "claude-opus-4-8", reasoningLevel: "high", resumeSessionId: "prov-abc" });
    expect(cmd.slice(0, 1)).toEqual(["claude"]);
    expect(cmd).toContain("--input-format");
    expect(cmd).toContain("--include-partial-messages");
    expect(cmd).toEqual(expect.arrayContaining(["--model", "claude-opus-4-8", "--effort", "high", "--resume", "prov-abc", "--permission-mode", "bypassPermissions"]));
    const bare = claudeAdapter.buildSpawn({ worktreePath: "/w", model: null, reasoningLevel: null, resumeSessionId: null });
    expect(bare).not.toContain("--model");
    expect(bare).not.toContain("--effort");
    expect(bare).not.toContain("--resume");
  });

  test("encodeInterrupt emits a control_request line", () => {
    const parsed = JSON.parse(claudeAdapter.encodeInterrupt("r1")!);
    expect(parsed).toEqual({ type: "control_request", request_id: "r1", request: { subtype: "interrupt" } });
  });
});

describe("adapterFor", () => {
  test("returns the claude adapter for every currently-shipping backend id", () => {
    for (const backend of ["claude", "claude-code", "codex", undefined]) {
      expect(adapterFor(backend)).toBe(claudeAdapter);
    }
  });
});

describe("claudeAdapter.capabilities", () => {
  test("scans worktree .claude/commands and always offers /compact first", () => {
    const worktree = mkdtempSync(join(tmpdir(), "mv-claude-caps-"));
    try {
      const dir = join(worktree, ".claude", "commands");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "deploy.md"), "# Deploy the app\n\nsteps...");
      writeFileSync(join(dir, "review.md"), "\nReview the current diff\n");
      writeFileSync(join(dir, "notes.txt"), "not a command");
      const caps = claudeAdapter.capabilities(worktree);
      expect(caps.models.map((m) => m.id)).toContain("default");
      expect(caps.reasoningLevels.map((r) => r.id)).toEqual(["default", "low", "medium", "high"]);
      expect(caps.supportsInterrupt).toBe(true);
      expect(caps.supportsConversationRewind).toBe(true);
      expect(caps.slashCommands[0]).toEqual({ name: "/compact", description: "Compact the conversation context" });
      expect(caps.slashCommands).toEqual(
        expect.arrayContaining([
          { name: "/deploy", description: "Deploy the app" },
          { name: "/review", description: "Review the current diff" },
        ]),
      );
      expect(caps.slashCommands.map((c) => c.name)).not.toContain("/notes");
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  test("a worktree without .claude/commands contributes nothing and does not throw", () => {
    const worktree = mkdtempSync(join(tmpdir(), "mv-claude-nocaps-"));
    try {
      const before = claudeAdapter.capabilities(worktree).slashCommands;
      mkdirSync(join(worktree, ".claude", "commands"), { recursive: true });
      writeFileSync(join(worktree, ".claude", "commands", "extra.md"), "# Extra");
      const after = claudeAdapter.capabilities(worktree).slashCommands;
      expect(before[0]).toEqual({ name: "/compact", description: "Compact the conversation context" });
      expect(before.map((c) => c.name)).not.toContain("/extra");
      expect(after.length).toBe(before.length + 1);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });
});

describe("claudeAdapter recorded fixture (claude 2.1.201)", () => {
  test("replaying a real NDJSON transcript maps every line", () => {
    const lines = readFileSync(join(import.meta.dir, "__fixtures__", "claude-stream-hello.ndjson"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    const c = ctx();
    const events: AgentEvent[] = [];
    for (const line of lines) events.push(...claudeAdapter.translate(line, c));

    expect(c.unknownLines).toBe(0);
    expect(events[0]).toEqual({
      type: "session-meta",
      providerSessionId: "cbd53134-cee0-4955-b17e-b76803b989c0",
      model: "claude-opus-4-8",
    });
    const end = events.find((e) => e.type === "message-end");
    expect(end).toBeDefined();
    expect((end as Extract<AgentEvent, { type: "message-end" }>).message.parts).toEqual([
      { type: "text", text: "Hello" },
    ]);
    expect(events.at(-1)).toEqual({
      type: "turn-end",
      turnId: "turn1",
      usage: { inputTokens: 15624, outputTokens: 5, costUsd: 0.1917695, durationMs: 3526 },
    });
  });
});
