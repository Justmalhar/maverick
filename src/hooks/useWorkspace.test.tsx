import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspace } from "./useWorkspace";
import { useWorkbench } from "@/state/store";
import { makeWorkspace, makeProject } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, workspaces: [], projects: [], activeWorkspaceId: null });
});

describe("useWorkspace", () => {
  it("create invokes workspace_create and activates the new workspace", async () => {
    const ws = makeWorkspace({ id: "w-new" });
    vi.mocked(invoke).mockResolvedValueOnce(ws as never);
    const { result } = renderHook(() => useWorkspace());
    await act(async () => {
      await result.current.create("p1", "main", "claude");
    });
    expect(invoke).toHaveBeenCalledWith("workspace_create", { projectId: "p1", branch: "main", backend: "claude" });
    expect(useWorkbench.getState().workspaces).toContainEqual(ws);
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w-new");
  });

  it("destroy removes the workspace from store", async () => {
    useWorkbench.getState().setWorkspaces([makeWorkspace({ id: "w1" })]);
    vi.mocked(invoke).mockResolvedValueOnce(undefined as never);
    const { result } = renderHook(() => useWorkspace());
    await act(async () => {
      await result.current.destroy("w1");
    });
    expect(useWorkbench.getState().workspaces).toHaveLength(0);
  });

  it("refreshWorkspaces and addProjectFromPath and refreshProjects", async () => {
    const list = [makeWorkspace()];
    vi.mocked(invoke).mockResolvedValueOnce(list as never);
    const { result } = renderHook(() => useWorkspace());
    await act(async () => {
      await result.current.refreshWorkspaces("p1");
    });
    expect(useWorkbench.getState().workspaces).toEqual(list);

    const p = makeProject();
    vi.mocked(invoke).mockResolvedValueOnce(p as never);
    await act(async () => {
      await result.current.addProjectFromPath("/tmp");
    });
    expect(useWorkbench.getState().projects).toContainEqual(p);

    vi.mocked(invoke).mockResolvedValueOnce([p] as never);
    await act(async () => {
      await result.current.refreshProjects();
    });
    expect(useWorkbench.getState().projects).toEqual([p]);
  });
});
