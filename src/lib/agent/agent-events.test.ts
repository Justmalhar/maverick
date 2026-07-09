import { describe, it, expect, beforeEach, vi } from "vitest";
import { __testing__, parseStoredMessages } from "./agent-events";
import { useAgentStore } from "@/state/agent-store";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";

vi.mock("@/lib/tauri", () => ({
  onAgentEvent: vi.fn().mockResolvedValue(() => {}),
  agentState: vi.fn(),
  messagesList: vi.fn(),
}));

const S = "sess1";
const W = "ws1";

beforeEach(() => {
  useAgentStore.setState({ sessions: {} });
  useAgentStatusStore.setState({ statuses: {} });
  __testing__.reset();
});

describe("handlePayload", () => {
  it("part-delta events buffer and flush together; non-delta events flush the buffer first (order preserved)", () => {
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "message-start", message: { id: "m1", sessionId: S, turnId: "t", role: "assistant", parts: [], createdAt: 1 } } });
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "part-start", messageId: "m1", partIndex: 0, part: { type: "text", text: "" } } });
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "part-delta", messageId: "m1", partIndex: 0, delta: "He" } });
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "part-delta", messageId: "m1", partIndex: 0, delta: "y" } });
    // deltas not applied yet (buffered)
    expect(useAgentStore.getState().sessions[S].messages[0].parts[0]).toEqual({ type: "text", text: "" });
    __testing__.flushNow();
    expect(useAgentStore.getState().sessions[S].messages[0].parts[0]).toEqual({ type: "text", text: "Hey" });
    // a message-end arriving with deltas pending flushes them BEFORE applying itself
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "part-delta", messageId: "m1", partIndex: 0, delta: "!" } });
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "message-end", message: { id: "m1", sessionId: S, turnId: "t", role: "assistant", parts: [{ type: "text", text: "Hey! (final)" }], createdAt: 1 } } });
    expect(useAgentStore.getState().sessions[S].messages[0].parts[0]).toEqual({ type: "text", text: "Hey! (final)" });
  });

  it("bridges status events to useAgentStatusStore keyed by workspaceId", () => {
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "status", status: "working" } });
    expect(useAgentStatusStore.getState().statuses[W]).toBe("working");
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "status", status: "error" } });
    expect(useAgentStatusStore.getState().statuses[W]).toBe("error");
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "status", status: "idle" } });
    expect(useAgentStatusStore.getState().statuses[W]).toBe("idle");
  });
});

describe("parseStoredMessages", () => {
  it("downgrades a tool-call part still \"running\" to \"error\" — the process died mid-call, no result is coming", () => {
    const [msg] = parseStoredMessages(
      [
        {
          id: "m1",
          sessionId: S,
          role: "assistant",
          content: "",
          createdAt: 1,
          turnId: "t1",
          partsJson: JSON.stringify([
            { type: "tool-call", toolUseId: "tu1", toolName: "Bash", title: "Bash", status: "running" },
            { type: "text", text: "hi" },
          ]),
        },
      ],
      S
    );
    expect(msg.parts[0]).toEqual({
      type: "tool-call",
      toolUseId: "tu1",
      toolName: "Bash",
      title: "Bash",
      status: "error",
      output: "(no result recorded — session interrupted)",
    });
    expect(msg.parts[1]).toEqual({ type: "text", text: "hi" });
  });

  it("leaves an already-resolved tool-call part untouched", () => {
    const [msg] = parseStoredMessages(
      [
        {
          id: "m1",
          sessionId: S,
          role: "assistant",
          content: "",
          createdAt: 1,
          turnId: "t1",
          partsJson: JSON.stringify([
            { type: "tool-call", toolUseId: "tu1", toolName: "Bash", title: "Bash", status: "ok", output: "done" },
          ]),
        },
      ],
      S
    );
    expect(msg.parts[0]).toEqual({ type: "tool-call", toolUseId: "tu1", toolName: "Bash", title: "Bash", status: "ok", output: "done" });
  });
});

describe("hydrateAgentSession", () => {
  it("fetches state + stored messages, parses parts_json, seeds the store", async () => {
    const { agentState, messagesList } = await import("@/lib/tauri");
    vi.mocked(agentState).mockResolvedValue({ sessionId: S, workspaceId: W, status: "idle", queue: [], model: null, reasoningLevel: null, providerSessionId: null });
    vi.mocked(messagesList).mockResolvedValue([
      { id: "m1", sessionId: S, role: "user", content: "hi", createdAt: 5, partsJson: JSON.stringify([{ type: "text", text: "hi" }]), turnId: "t1" },
      { id: "legacy", sessionId: S, role: "assistant", content: "old row without parts", createdAt: 6 },
    ]);
    const { hydrateAgentSession } = await import("./agent-events");
    await hydrateAgentSession(W, S);
    const msgs = useAgentStore.getState().sessions[S].messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].parts).toEqual([{ type: "text", text: "hi" }]);
    expect(msgs[1].parts).toEqual([{ type: "text", text: "old row without parts" }]);
  });
});
