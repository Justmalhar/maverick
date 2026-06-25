import { useEffect } from "react";
import { useWorkbench } from "@/state/store";
import { agentRun, onAgentData, onAgentExit, onAgentError } from "@/lib/tauri";
import { parseAgentEvent, LineBuffer, type AgentDelta } from "@/lib/agent-stream";
import { useAgentOutput } from "@/lib/stores/agent-output";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";
import type { Workspace } from "@/lib/ipc";

// Workspaces whose staged agent-run spec has already been consumed, so keep-alive
// remounts never re-spawn a background agent for the same workspace (mirrors the
// useLaunchSpec single-shot guard).
const started = new Set<string>();

/** Test-only: forget every recorded run so each test starts clean. */
export function __resetAgentRunsForTests(): void {
  started.clear();
}

function applyDelta(workspaceId: string, d: AgentDelta): void {
  const out = useAgentOutput.getState();
  const status = useAgentStatusStore.getState();
  switch (d.kind) {
    case "text":
      out.appendLine(workspaceId, { kind: "text", text: d.text });
      break;
    case "tool":
      out.appendLine(workspaceId, { kind: "tool", text: d.summary });
      break;
    case "session":
      out.setSession(workspaceId, d.sessionId);
      break;
    case "result":
      if (d.sessionId) out.setSession(workspaceId, d.sessionId);
      if (d.text) out.appendLine(workspaceId, { kind: "result", text: d.text, isError: d.isError });
      out.finish(workspaceId, { costUsd: d.costUsd });
      status.setStatus(workspaceId, d.isError ? "error" : "done");
      break;
    case "stderr":
      out.appendLine(workspaceId, { kind: "stderr", text: d.text });
      break;
  }
}

/**
 * Drives a HEADLESS agent run for a workspace: when a run is staged (via
 * setAgentLaunchSpec — the "run in background" launch surface), spawn it once,
 * stream its stream-json output into the per-workspace Agent Output store, and
 * derive the status pill from parsed events (init/assistant → working,
 * result → done/error). No PTY, no terminal. No-op when nothing is staged.
 */
export function useAgentRun(workspace: Workspace): void {
  const workspaceId = workspace.id;

  useEffect(() => {
    if (started.has(workspaceId)) return;
    const spec = useWorkbench.getState().consumeAgentLaunchSpec(workspaceId);
    if (!spec) return;
    started.add(workspaceId);

    const out = useAgentOutput.getState();
    out.start(workspaceId);
    useAgentStatusStore.getState().setStatus(workspaceId, "working");

    let cancelled = false;
    const stdoutBuf = new LineBuffer();
    const drain = (lines: string[]) => {
      for (const line of lines) {
        try {
          for (const d of parseAgentEvent(JSON.parse(line))) applyDelta(workspaceId, d);
        } catch {
          /* partial/non-JSON line — LineBuffer holds the rest */
        }
      }
    };

    void agentRun(spec).catch((e) => {
      if (cancelled) return;
      out.appendLine(workspaceId, { kind: "stderr", text: `Failed to start agent: ${String(e)}` });
      useAgentStatusStore.getState().setStatus(workspaceId, "error");
    });

    const unData = onAgentData((p) => {
      if (cancelled || p.workspaceId !== workspaceId) return;
      if (p.stream === "stderr") {
        out.appendLine(workspaceId, { kind: "stderr", text: p.data });
        return;
      }
      drain(stdoutBuf.push(p.data));
    });
    const unExit = onAgentExit((p) => {
      if (cancelled || p.workspaceId !== workspaceId) return;
      const tail = stdoutBuf.flush();
      if (tail) drain([tail]);
      out.finish(workspaceId);
      // Non-zero exit with no result event is an error the result branch missed.
      if (p.code !== 0) useAgentStatusStore.getState().setStatus(workspaceId, "error");
    });
    const unErr = onAgentError((p) => {
      if (cancelled || p.workspaceId !== workspaceId) return;
      out.appendLine(workspaceId, { kind: "stderr", text: p.message });
    });

    return () => {
      cancelled = true;
      void unData.then((u) => u()).catch(() => {});
      void unExit.then((u) => u()).catch(() => {});
      void unErr.then((u) => u()).catch(() => {});
    };
  }, [workspaceId]);
}
