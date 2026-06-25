import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderHook, act } from "@testing-library/react";
import { useAgentRun, __resetAgentRunsForTests } from "./useAgentRun";
import { useWorkbench } from "@/state/store";
import { useAgentOutput, selectAgentRun } from "@/lib/stores/agent-output";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";
import { makeWorkspace } from "@/test/fixtures";
import type { Workspace } from "@/lib/ipc";

const captured: Record<string, (e: { payload: unknown }) => void> = {};

function emitData(workspaceId: string, data: string, stream: "stdout" | "stderr" = "stdout") {
  captured["agent:data"]?.({ payload: { agentId: "a1", workspaceId, stream, data } });
}
function emitExit(workspaceId: string, code: number) {
  captured["agent:exit"]?.({ payload: { agentId: "a1", workspaceId, code } });
}
function emitErr(workspaceId: string, message: string) {
  captured["agent:error"]?.({ payload: { agentId: "a1", workspaceId, message } });
}

async function mount(ws: Workspace) {
  const r = renderHook(() => useAgentRun(ws));
  await act(async () => {});
  return r;
}

function run(workspaceId: string) {
  return selectAgentRun(workspaceId)(useAgentOutput.getState());
}

beforeEach(() => {
  for (const k of Object.keys(captured)) delete captured[k];
  vi.mocked(invoke).mockReset().mockResolvedValue({ agentId: "a1" } as never);
  vi.mocked(listen)
    .mockReset()
    .mockImplementation((async (event: string, cb: (e: { payload: unknown }) => void) => {
      captured[event] = cb;
      return vi.fn();
    }) as unknown as typeof listen);
  __resetAgentRunsForTests();
  useWorkbench.setState({ agentLaunchSpecs: {} });
  useAgentOutput.setState({ runs: {} });
  useAgentStatusStore.setState({ statuses: {} });
});

describe("useAgentRun", () => {
  it("no-ops when no agent spec is staged", async () => {
    await mount(makeWorkspace({ id: "w1" }));
    expect(vi.mocked(invoke).mock.calls.some((c) => c[0] === "agent_run")).toBe(false);
    expect(useAgentStatusStore.getState().statuses["w1"]).toBeUndefined();
  });

  it("consumes the staged spec once, calls agent_run, flips status to working", async () => {
    useWorkbench.getState().setAgentLaunchSpec("w1", { workspaceId: "w1", backend: "claude-code", prompt: "do it" });
    await mount(makeWorkspace({ id: "w1" }));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("agent_run", { workspaceId: "w1", backend: "claude-code", prompt: "do it" });
    expect(useWorkbench.getState().agentLaunchSpecs["w1"]).toBeUndefined();
    expect(useAgentStatusStore.getState().statuses["w1"]).toBe("working");
    expect(run("w1").running).toBe(true);
  });

  it("parses stream-json: session, assistant text + tool, then result→done+cost", async () => {
    useWorkbench.getState().setAgentLaunchSpec("w1", { workspaceId: "w1", backend: "claude-code", prompt: "p" });
    await mount(makeWorkspace({ id: "w1" }));
    act(() => {
      emitData("w1", '{"type":"system","subtype":"init","session_id":"sess-1"}\n');
      emitData("w1", '{"type":"assistant","message":{"content":[{"type":"text","text":"Editing"},{"type":"tool_use","name":"Edit","input":{"file_path":"a/b.ts"}}]}}\n');
      emitData("w1", '{"type":"result","result":"Done.","session_id":"sess-1","total_cost_usd":0.03,"is_error":false}\n');
    });
    const r = run("w1");
    expect(r.sessionId).toBe("sess-1");
    expect(r.lines.map((l) => `${l.kind}:${l.text}`)).toEqual(["text:Editing", "tool:Edit a/b.ts", "result:Done."]);
    expect(r.running).toBe(false);
    expect(r.costUsd).toBe(0.03);
    expect(useAgentStatusStore.getState().statuses["w1"]).toBe("done");
  });

  it("reassembles JSON split across two data chunks", async () => {
    useWorkbench.getState().setAgentLaunchSpec("w1", { workspaceId: "w1", backend: "claude-code", prompt: "p" });
    await mount(makeWorkspace({ id: "w1" }));
    act(() => {
      emitData("w1", '{"type":"assistant","message":{"content":[{"type":"text","te');
      emitData("w1", 'xt":"split ok"}]}}\n');
    });
    expect(run("w1").lines.map((l) => l.text)).toEqual(["split ok"]);
  });

  it("streams stderr as its own line and marks error on nonzero exit", async () => {
    useWorkbench.getState().setAgentLaunchSpec("w1", { workspaceId: "w1", backend: "claude-code", prompt: "p" });
    await mount(makeWorkspace({ id: "w1" }));
    act(() => {
      emitData("w1", "boom!\n", "stderr");
      emitExit("w1", 1);
    });
    const r = run("w1");
    expect(r.lines.some((l) => l.kind === "stderr" && l.text.includes("boom"))).toBe(true);
    expect(r.running).toBe(false);
    expect(useAgentStatusStore.getState().statuses["w1"]).toBe("error");
  });

  it("agent.error events surface in the output", async () => {
    useWorkbench.getState().setAgentLaunchSpec("w1", { workspaceId: "w1", backend: "claude-code", prompt: "p" });
    await mount(makeWorkspace({ id: "w1" }));
    act(() => emitErr("w1", "stream broke"));
    expect(run("w1").lines.some((l) => l.text.includes("stream broke"))).toBe(true);
  });

  it("error status + message when agent_run rejects", async () => {
    vi.mocked(invoke).mockReset().mockRejectedValue(new Error("claude not found"));
    useWorkbench.getState().setAgentLaunchSpec("w1", { workspaceId: "w1", backend: "claude-code", prompt: "p" });
    await mount(makeWorkspace({ id: "w1" }));
    expect(useAgentStatusStore.getState().statuses["w1"]).toBe("error");
    expect(run("w1").lines.some((l) => l.text.includes("Failed to start"))).toBe(true);
  });

  it("ignores events for other workspaces", async () => {
    useWorkbench.getState().setAgentLaunchSpec("w1", { workspaceId: "w1", backend: "claude-code", prompt: "p" });
    await mount(makeWorkspace({ id: "w1" }));
    act(() => emitData("other", '{"type":"assistant","message":{"content":[{"type":"text","text":"nope"}]}}\n'));
    expect(run("w1").lines).toEqual([]);
  });

  it("does not re-spawn on remount (single-shot guard)", async () => {
    useWorkbench.getState().setAgentLaunchSpec("w1", { workspaceId: "w1", backend: "claude-code", prompt: "p" });
    await mount(makeWorkspace({ id: "w1" }));
    const calls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "agent_run").length;
    await mount(makeWorkspace({ id: "w1" }));
    expect(vi.mocked(invoke).mock.calls.filter((c) => c[0] === "agent_run").length).toBe(calls);
  });
});
