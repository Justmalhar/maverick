import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useAgentNotifications } from "./useAgentNotifications";
import { useAgentStatusStore, type AgentStatus } from "./useAgentStatus";
import { useWorkbench } from "@/state/store";
import { useSettingsStore } from "@/lib/stores/settings";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

function setStatus(id: string, status: AgentStatus) {
  act(() => {
    useAgentStatusStore.getState().setStatus(id, status);
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  useAgentStatusStore.setState({ statuses: {} });
  useSettingsStore.setState({ values: {} }); // defaults (all toggles on)
  useWorkbench.setState({ ...initial, workspaces: [makeWorkspace({ id: "w1", title: "Fix login" })] });
});

describe("useAgentNotifications", () => {
  it("notifies when an agent finishes (idle/undefined -> done)", () => {
    renderHook(() => useAgentNotifications());
    setStatus("w1", "done");
    expect(invoke).toHaveBeenCalledWith(
      "notify_send",
      expect.objectContaining({ workspaceId: "w1", type: "agent.done" })
    );
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "notify_send");
    expect((call?.[1] as { body: string }).body).toContain("Fix login");
  });

  it("notifies when an agent needs attention (working -> attention)", () => {
    renderHook(() => useAgentNotifications());
    setStatus("w1", "working");
    setStatus("w1", "attention");
    expect(invoke).toHaveBeenCalledWith(
      "notify_send",
      expect.objectContaining({ workspaceId: "w1", type: "agent.attention" })
    );
  });

  it("notifies on error (working -> error)", () => {
    renderHook(() => useAgentNotifications());
    setStatus("w1", "working");
    setStatus("w1", "error");
    expect(invoke).toHaveBeenCalledWith(
      "notify_send",
      expect.objectContaining({ workspaceId: "w1", type: "agent.error" })
    );
  });

  it("does not notify for working or idle transitions", () => {
    renderHook(() => useAgentNotifications());
    setStatus("w1", "working");
    setStatus("w1", "idle");
    expect(invoke).not.toHaveBeenCalledWith("notify_send", expect.anything());
  });

  it("does not fire for statuses that already existed before mount", () => {
    act(() => useAgentStatusStore.setState({ statuses: { w1: "done" } }));
    renderHook(() => useAgentNotifications());
    expect(invoke).not.toHaveBeenCalledWith("notify_send", expect.anything());
  });

  it("does not double-fire when the same status is re-set", () => {
    renderHook(() => useAgentNotifications());
    setStatus("w1", "done");
    setStatus("w1", "done");
    const sends = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "notify_send");
    expect(sends).toHaveLength(1);
  });

  it("respects the per-event toggle — no notification when disabled (#32)", () => {
    useSettingsStore.setState({ values: { "notifications.agent.complete": false } });
    renderHook(() => useAgentNotifications());
    setStatus("w1", "done");
    expect(invoke).not.toHaveBeenCalledWith("notify_send", expect.anything());
  });

  it("still notifies for an event whose toggle is left on while another is off (#32)", () => {
    useSettingsStore.setState({ values: { "notifications.agent.complete": false } });
    renderHook(() => useAgentNotifications());
    setStatus("w1", "working");
    setStatus("w1", "error"); // error toggle still on
    expect(invoke).toHaveBeenCalledWith("notify_send", expect.objectContaining({ type: "agent.error" }));
  });

  it("falls back to the branch when the workspace has no title", () => {
    useWorkbench.setState({ ...initial, workspaces: [makeWorkspace({ id: "w2", title: undefined, branch: "feat/x" })] });
    renderHook(() => useAgentNotifications());
    setStatus("w2", "done");
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "notify_send");
    expect((call?.[1] as { body: string }).body).toContain("feat/x");
  });
});
