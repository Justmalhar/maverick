import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore, emptySession } from "./agent-store";
import type { AgentChatMessage } from "@/lib/ipc";

const S = "sess1";
const msg = (id: string, role: "user" | "assistant" = "assistant"): AgentChatMessage => ({
  id, sessionId: S, turnId: "t1", role, parts: [], createdAt: 1,
});

beforeEach(() => useAgentStore.setState({ sessions: {} }));

describe("applyEvent", () => {
  it("message-start appends a streaming message; message-end replaces it with the final one", () => {
    const { applyEvent } = useAgentStore.getState();
    applyEvent(S, { type: "message-start", message: msg("m1") });
    expect(useAgentStore.getState().sessions[S].messages).toHaveLength(1);
    const final = { ...msg("m1"), parts: [{ type: "text" as const, text: "done" }] };
    applyEvent(S, { type: "message-end", message: final });
    const msgs = useAgentStore.getState().sessions[S].messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].parts).toEqual([{ type: "text", text: "done" }]);
  });

  it("part-start / part-end mutate the addressed part immutably", () => {
    const { applyEvent } = useAgentStore.getState();
    applyEvent(S, { type: "message-start", message: msg("m1") });
    applyEvent(S, { type: "part-start", messageId: "m1", partIndex: 0, part: { type: "text", text: "" } });
    const before = useAgentStore.getState().sessions[S].messages[0];
    applyEvent(S, {
      type: "part-end", messageId: "m1", partIndex: 0,
      part: { type: "tool-call", toolUseId: "t", toolName: "Bash", title: "run", status: "ok", output: "x" },
    });
    const after = useAgentStore.getState().sessions[S].messages[0];
    expect(after).not.toBe(before);
    expect(after.parts[0]).toMatchObject({ type: "tool-call", status: "ok" });
  });

  it("part-end for a tool-call merges terminal fields onto the existing part (adapter sends blank toolName)", () => {
    const { applyEvent } = useAgentStore.getState();
    applyEvent(S, { type: "message-start", message: msg("m1") });
    applyEvent(S, { type: "part-start", messageId: "m1", partIndex: 0, part: { type: "tool-call", toolUseId: "t", toolName: "Bash", title: "List files", detail: "ls", status: "running" } });
    applyEvent(S, { type: "part-end", messageId: "m1", partIndex: 0, part: { type: "tool-call", toolUseId: "t", toolName: "", title: "", status: "ok", output: "out", durationMs: 9 } });
    expect(useAgentStore.getState().sessions[S].messages[0].parts[0]).toEqual({
      type: "tool-call", toolUseId: "t", toolName: "Bash", title: "List files", detail: "ls", status: "ok", output: "out", durationMs: 9,
    });
  });

  it("status / queue-updated update the slice", () => {
    const { applyEvent } = useAgentStore.getState();
    applyEvent(S, { type: "status", status: "working" });
    applyEvent(S, { type: "queue-updated", queue: [{ id: "q1", parts: [], createdAt: 1 }] });
    expect(useAgentStore.getState().sessions[S]).toMatchObject({ status: "working", queue: [{ id: "q1" }] });
  });

  it("error event appends a system error message", () => {
    useAgentStore.getState().applyEvent(S, { type: "error", message: "boom", recoverable: true });
    const msgs = useAgentStore.getState().sessions[S].messages;
    expect(msgs.at(-1)).toMatchObject({ role: "system", parts: [{ type: "text", text: "boom" }] });
  });
});

describe("applyDeltas", () => {
  it("appends batched text to the addressed parts in one state write", () => {
    const { applyEvent, applyDeltas } = useAgentStore.getState();
    applyEvent(S, { type: "message-start", message: msg("m1") });
    applyEvent(S, { type: "part-start", messageId: "m1", partIndex: 0, part: { type: "text", text: "" } });
    applyDeltas(S, [
      { messageId: "m1", partIndex: 0, delta: "Hel" },
      { messageId: "m1", partIndex: 0, delta: "lo" },
    ]);
    expect(useAgentStore.getState().sessions[S].messages[0].parts[0]).toEqual({ type: "text", text: "Hello" });
  });

  it("thinking deltas extend the summary", () => {
    const { applyEvent, applyDeltas } = useAgentStore.getState();
    applyEvent(S, { type: "message-start", message: msg("m1") });
    applyEvent(S, { type: "part-start", messageId: "m1", partIndex: 0, part: { type: "thinking", summary: "" } });
    applyDeltas(S, [{ messageId: "m1", partIndex: 0, delta: "hmm" }]);
    expect(useAgentStore.getState().sessions[S].messages[0].parts[0]).toEqual({ type: "thinking", summary: "hmm" });
  });
});

describe("emptySession", () => {
  it("returns the default session slice", () => {
    expect(emptySession()).toEqual({
      messages: [], status: "idle", queue: [], model: null, reasoningLevel: null, hydrated: false,
    });
  });
});

describe("setOptionsLocal", () => {
  it("patches model only, leaving reasoningLevel untouched", () => {
    useAgentStore.getState().setOptionsLocal(S, { reasoningLevel: "high" });
    useAgentStore.getState().setOptionsLocal(S, { model: "claude-opus-4-8" });
    expect(useAgentStore.getState().sessions[S]).toMatchObject({ model: "claude-opus-4-8", reasoningLevel: "high" });
  });

  it("patches reasoningLevel only, leaving model untouched", () => {
    useAgentStore.getState().setOptionsLocal(S, { model: "claude-opus-4-8" });
    useAgentStore.getState().setOptionsLocal(S, { reasoningLevel: "low" });
    expect(useAgentStore.getState().sessions[S]).toMatchObject({ model: "claude-opus-4-8", reasoningLevel: "low" });
  });
});

describe("reset", () => {
  it("deletes the addressed session and leaves others untouched", () => {
    const { applyEvent, reset } = useAgentStore.getState();
    applyEvent(S, { type: "status", status: "working" });
    applyEvent("other", { type: "status", status: "working" });
    reset(S);
    const { sessions } = useAgentStore.getState();
    expect(sessions[S]).toBeUndefined();
    expect(sessions.other).toMatchObject({ status: "working" });
  });
});

describe("hydrate", () => {
  it("replaces messages and marks hydrated without clobbering a later streaming status", () => {
    useAgentStore.getState().hydrate(S, [msg("m1", "user")], {
      sessionId: S, workspaceId: "w1", status: "idle", queue: [], model: "claude-opus-4-8", reasoningLevel: null, providerSessionId: null,
    });
    expect(useAgentStore.getState().sessions[S]).toMatchObject({ hydrated: true, model: "claude-opus-4-8", status: "idle" });
    expect(useAgentStore.getState().sessions[S].messages).toHaveLength(1);
  });
});
