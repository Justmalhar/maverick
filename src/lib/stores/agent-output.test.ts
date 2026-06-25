import { describe, it, expect, beforeEach } from "vitest";
import { useAgentOutput, selectAgentRun } from "./agent-output";

beforeEach(() => {
  useAgentOutput.setState({ runs: {} });
});

describe("useAgentOutput", () => {
  it("start marks a workspace running with empty history", () => {
    useAgentOutput.getState().start("w1");
    expect(selectAgentRun("w1")(useAgentOutput.getState())).toMatchObject({ running: true, lines: [] });
  });

  it("appendLine appends with incrementing ids", () => {
    const s = useAgentOutput.getState();
    s.appendLine("w1", { kind: "text", text: "a" });
    s.appendLine("w1", { kind: "tool", text: "Edit x.ts" });
    const run = selectAgentRun("w1")(useAgentOutput.getState());
    expect(run.lines.map((l) => l.text)).toEqual(["a", "Edit x.ts"]);
    expect(run.lines[0].id).not.toBe(run.lines[1].id);
  });

  it("caps the buffer at MAX_LINES, dropping oldest", () => {
    const s = useAgentOutput.getState();
    for (let i = 0; i < 5005; i++) s.appendLine("w1", { kind: "text", text: `l${i}` });
    const run = selectAgentRun("w1")(useAgentOutput.getState());
    expect(run.lines.length).toBe(5000);
    expect(run.lines[0].text).toBe("l5"); // first 5 dropped
    expect(run.lines[run.lines.length - 1].text).toBe("l5004");
  });

  it("setSession records the resume session id", () => {
    useAgentOutput.getState().setSession("w1", "sess-7");
    expect(selectAgentRun("w1")(useAgentOutput.getState()).sessionId).toBe("sess-7");
  });

  it("finish clears running and records cost", () => {
    const s = useAgentOutput.getState();
    s.start("w1");
    s.finish("w1", { costUsd: 0.05 });
    const run = selectAgentRun("w1")(useAgentOutput.getState());
    expect(run.running).toBe(false);
    expect(run.costUsd).toBe(0.05);
  });

  it("clearForWorkspace removes a workspace's run", () => {
    const s = useAgentOutput.getState();
    s.appendLine("w1", { kind: "text", text: "a" });
    s.clearForWorkspace("w1");
    expect(useAgentOutput.getState().runs.w1).toBeUndefined();
    // selector still returns a safe empty default
    expect(selectAgentRun("w1")(useAgentOutput.getState()).lines).toEqual([]);
  });
});
