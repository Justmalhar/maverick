import { describe, it, expect } from "vitest";
import { groupIntoTurns, aggregateTurnFileChanges } from "./turns";
import type { AgentChatMessage, AgentPart } from "@/lib/ipc";

const m = (id: string, turnId: string, role: AgentChatMessage["role"], parts: AgentPart[] = []): AgentChatMessage => ({
  id, turnId, role, sessionId: "s", parts, createdAt: 1,
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

describe("aggregateTurnFileChanges", () => {
  const toolCall = (path: string, additions: number, deletions: number, kind: "edit" | "create" | "delete" = "edit"): AgentPart => ({
    type: "tool-call", toolUseId: `tu_${path}_${additions}_${deletions}`, toolName: "Edit", title: "Edit", status: "ok",
    fileChanges: [{ path, additions, deletions, kind }],
  });

  it("sums additions/deletions for the same path across multiple tool-call parts", () => {
    const messages = [
      m("a1", "t1", "assistant", [toolCall("/w/a.ts", 3, 1), toolCall("/w/b.ts", 1, 0)]),
      m("a2", "t1", "assistant", [toolCall("/w/a.ts", 2, 4)]),
    ];
    expect(aggregateTurnFileChanges(messages)).toEqual([
      { path: "/w/a.ts", additions: 5, deletions: 5, kind: "edit" },
      { path: "/w/b.ts", additions: 1, deletions: 0, kind: "edit" },
    ]);
  });

  it("ignores parts without fileChanges and non-tool-call parts", () => {
    const messages = [m("a1", "t1", "assistant", [{ type: "text", text: "hi" }, { ...toolCall("/w/c.ts", 1, 1) }])];
    expect(aggregateTurnFileChanges(messages)).toEqual([{ path: "/w/c.ts", additions: 1, deletions: 1, kind: "edit" }]);
  });

  it("returns an empty array for messages with no file changes", () => {
    expect(aggregateTurnFileChanges([m("a1", "t1", "assistant", [{ type: "text", text: "hi" }])])).toEqual([]);
  });

  it("create-then-edit on the same path: the last-seen kind wins", () => {
    const messages = [
      m("a1", "t1", "assistant", [toolCall("/w/new.ts", 10, 0, "create"), toolCall("/w/new.ts", 2, 1, "edit")]),
    ];
    expect(aggregateTurnFileChanges(messages)).toEqual([
      { path: "/w/new.ts", additions: 12, deletions: 1, kind: "edit" },
    ]);
  });
});
