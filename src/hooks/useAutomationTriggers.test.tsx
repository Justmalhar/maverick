import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import { useAutomationTriggers } from "./useAutomationTriggers";
import { useWorkbench } from "@/state/store";
import { makeWorkspace, makeProject } from "@/test/fixtures";

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
});

describe("useAutomationTriggers", () => {
  it("activates on mount and deactivates on unmount", async () => {
    useWorkbench.setState({ projects: [makeProject({ id: "p1", name: "P", path: "/p1" })] });
    const ws = makeWorkspace({ id: "w1", projectId: "p1", worktreePath: "/wt1" });
    const { unmount } = renderHook(() => useAutomationTriggers(ws));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("automation_activate_triggers", {
        workspaceId: "w1",
        projectPath: "/p1",
        worktreePath: "/wt1",
      }),
    );
    unmount();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("automation_deactivate_triggers", { workspaceId: "w1" }),
    );
  });

  it("does nothing when the project path is unknown", () => {
    useWorkbench.setState({ projects: [] });
    const ws = makeWorkspace({ id: "w2", projectId: "missing", worktreePath: "/wt2" });
    renderHook(() => useAutomationTriggers(ws));
    expect(invoke).not.toHaveBeenCalledWith("automation_activate_triggers", expect.anything());
  });
});
