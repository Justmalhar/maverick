import { describe, it, expect } from "vitest";
import { parseAgentEvent, parseAgentChunk, LineBuffer } from "./agent-stream";

describe("parseAgentEvent", () => {
  it("extracts session_id from a system init event", () => {
    expect(parseAgentEvent({ type: "system", subtype: "init", session_id: "sess-1" })).toEqual([
      { kind: "session", sessionId: "sess-1" },
    ]);
  });

  it("ignores non-init system events", () => {
    expect(parseAgentEvent({ type: "system", subtype: "hook_started" })).toEqual([]);
  });

  it("extracts assistant text blocks (skipping empty ones)", () => {
    const ev = {
      type: "assistant",
      message: { content: [{ type: "text", text: "Working on it" }, { type: "text", text: "   " }] },
    };
    expect(parseAgentEvent(ev)).toEqual([{ kind: "text", text: "Working on it" }]);
  });

  it("summarizes tool_use with a short target", () => {
    const ev = {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Edit", input: { file_path: "C:/Users/m/proj/src/app.ts" } },
          { type: "tool_use", name: "Bash", input: { command: "npm test" } },
          { type: "tool_use", name: "Glob", input: {} },
        ],
      },
    };
    expect(parseAgentEvent(ev)).toEqual([
      { kind: "tool", tool: "Edit", summary: "Edit src/app.ts" },
      { kind: "tool", tool: "Bash", summary: "Bash npm test" },
      { kind: "tool", tool: "Glob", summary: "Glob" },
    ]);
  });

  it("parses a successful result with cost + session", () => {
    expect(
      parseAgentEvent({
        type: "result",
        subtype: "success",
        result: "Done.",
        session_id: "sess-2",
        total_cost_usd: 0.12,
        is_error: false,
      })
    ).toEqual([{ kind: "result", text: "Done.", sessionId: "sess-2", costUsd: 0.12, isError: false }]);
  });

  it("flags an error result", () => {
    expect(parseAgentEvent({ type: "result", is_error: true })).toEqual([
      { kind: "result", text: "", isError: true },
    ]);
  });

  it("returns [] for unknown types and non-objects", () => {
    expect(parseAgentEvent({ type: "user" })).toEqual([]);
    expect(parseAgentEvent("nope")).toEqual([]);
    expect(parseAgentEvent(null)).toEqual([]);
  });
});

describe("parseAgentChunk", () => {
  it("parses multiple newline-delimited events and skips junk", () => {
    const chunk =
      '{"type":"system","subtype":"init","session_id":"s"}\n' +
      "not json\n" +
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}\n';
    expect(parseAgentChunk(chunk)).toEqual([
      { kind: "session", sessionId: "s" },
      { kind: "text", text: "hi" },
    ]);
  });
});

describe("LineBuffer", () => {
  it("yields complete lines and holds a partial tail across pushes", () => {
    const b = new LineBuffer();
    expect(b.push('{"a":1}\n{"b":')).toEqual(['{"a":1}']);
    expect(b.push('2}\n')).toEqual(['{"b":2}']);
    expect(b.push("")).toEqual([]);
  });

  it("flush returns the buffered tail once", () => {
    const b = new LineBuffer();
    b.push("tail-without-newline");
    expect(b.flush()).toBe("tail-without-newline");
    expect(b.flush()).toBe("");
  });
});
