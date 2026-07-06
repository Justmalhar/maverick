import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAutopilotBridge } from "./useAutopilotBridge";
import { useWorkbench } from "@/state/store";
import { makeProject, makeBackend } from "@/test/fixtures";
import type { AutopilotTriggered } from "@/lib/tauri";

const initial = useWorkbench.getState();
let triggerHandlers: Array<(payload: AutopilotTriggered) => void>;

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  triggerHandlers = [];
  vi.mocked(listen).mockReset().mockImplementation((async (
    event: string,
    cb: (e: { payload: AutopilotTriggered }) => void
  ) => {
    if (event === "autopilot:triggered") {
      triggerHandlers.push((p) => cb({ payload: p }));
    }
    return () => {};
  }) as unknown as typeof listen);
  useWorkbench.setState({ ...initial, projects: [], workspaces: [], backends: [], launchSpecs: {} });
});

function fire(t: AutopilotTriggered) {
  triggerHandlers[0](t);
}

describe("useAutopilotBridge", () => {
  it("creates a workspace and stages the launch prompt without stealing focus", async () => {
    useWorkbench.setState({ ...initial, projects: [makeProject({ id: "p1", path: "/tmp/p1" })] });
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "workspace_create") {
        return {
          id: "ws-new", projectId: "p1", branch: "auto", agentBackend: "claude",
          worktreePath: "/tmp/p1/wt", status: "active", sessionId: "s1",
        } as never;
      }
      return undefined as never;
    });
    renderHook(() => useAutopilotBridge());
    await waitFor(() => expect(triggerHandlers.length).toBeGreaterThan(0));

    fire({ autopilotId: "a1", projectId: "p1", name: "nightly", backend: "claude", branch: "", prompt: "do the thing" });

    await waitFor(() => expect(useWorkbench.getState().workspaces.some((w) => w.id === "ws-new")).toBe(true));
    expect(useWorkbench.getState().launchSpecs["ws-new"]).toMatchObject({ prompt: "do the thing" });
    expect(useWorkbench.getState().activeWorkspaceId).not.toBe("ws-new");
  });

  it("logs an error and does not throw when the project no longer exists", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useAutopilotBridge());
    await waitFor(() => expect(triggerHandlers.length).toBeGreaterThan(0));

    fire({ autopilotId: "a1", projectId: "ghost", name: "x", backend: "claude", branch: "", prompt: "p" });

    await waitFor(() => expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("ghost")));
    expect(invoke).not.toHaveBeenCalledWith("workspace_create", expect.anything());
    errSpy.mockRestore();
  });

  it("falls back to the active backend when the autopilot's backend is blank", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", path: "/tmp/p1" })],
      backends: [makeBackend({ id: "codex", active: true })],
    });
    const calls: unknown[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === "workspace_create") {
        calls.push(args);
        return {
          id: "ws-2", projectId: "p1", branch: "b", agentBackend: "codex",
          worktreePath: "/x", status: "active", sessionId: "s",
        } as never;
      }
      return undefined as never;
    });
    renderHook(() => useAutopilotBridge());
    await waitFor(() => expect(triggerHandlers.length).toBeGreaterThan(0));

    fire({ autopilotId: "a1", projectId: "p1", name: "x", backend: "", branch: "", prompt: "p" });

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ backend: "codex" });
  });

  it("logs an error when workspace creation fails", async () => {
    useWorkbench.setState({ ...initial, projects: [makeProject({ id: "p1", path: "/tmp/p1" })] });
    vi.mocked(invoke).mockRejectedValue(new Error("git worktree failed"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useAutopilotBridge());
    await waitFor(() => expect(triggerHandlers.length).toBeGreaterThan(0));

    fire({ autopilotId: "a1", projectId: "p1", name: "flaky", backend: "claude", branch: "", prompt: "p" });

    await waitFor(() => expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("flaky"),
      expect.any(Error)
    ));
    errSpy.mockRestore();
  });

  it("unsubscribes on unmount", async () => {
    const unlisten = vi.fn();
    vi.mocked(listen).mockReset().mockResolvedValue(unlisten);
    const { unmount } = renderHook(() => useAutopilotBridge());
    await waitFor(() => expect(listen).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});
