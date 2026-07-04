import { describe, it, expect } from "vitest";
import { groupIntoTurns } from "./turns";
import type { AgentChatMessage } from "@/lib/ipc";

const m = (id: string, turnId: string, role: AgentChatMessage["role"]): AgentChatMessage => ({
  id, turnId, role, sessionId: "s", parts: [], createdAt: 1,
});

describe("groupIntoTurns", () => {
  it("groups user + assistant messages by turnId preserving order", () => {
    const turns = groupIntoTurns([
      m("u1", "t1", "user"), m("a1", "t1", "assistant"), m("a2", "t1", "assistant"),
      m("u2", "t2", "user"), m("a3", "t2", "assistant"),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ turnId: "t1", user: { id: "u1" } });
    expect(turns[0].assistant.map((x) => x.id)).toEqual(["a1", "a2"]);
  });

  it("system messages attach to the current turn; orphan assistants open a turn", () => {
    const turns = groupIntoTurns([m("a0", "t0", "assistant"), m("e1", "error", "system")]);
    expect(turns).toHaveLength(1);
    expect(turns[0].user).toBeNull();
    expect(turns[0].system.map((x) => x.id)).toEqual(["e1"]);
  });

  it("an assistant message stamped with the error sentinel turnId stays in the open turn", () => {
    const turns = groupIntoTurns([m("u1", "t1", "user"), m("a1", "error", "assistant")]);
    expect(turns).toHaveLength(1);
    expect(turns[0].turnId).toBe("t1");
    expect(turns[0].assistant.map((x) => x.id)).toEqual(["a1"]);
  });
});
