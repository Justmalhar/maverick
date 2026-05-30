import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspace } from "./useWorkspace";
import { useWorkbench } from "@/state/store";
import { makeWorkspace, makeProject } from "@/test/fixtures";
import type { DetectedBackend, BootstrapStatus } from "@/lib/ipc";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, workspaces: [], projects: [], activeWorkspaceId: null });
});

describe("useWorkspace", () => {
  it("create invokes workspace_create with the project path and activates the new workspace", async () => {
    const ws = makeWorkspace({ id: "w-new" });
    useWorkbench.setState({
      ...initial,
      workspaces: [],
      activeWorkspaceId: null,
      projects: [makeProject({ id: "p1", path: "/tmp/p1" })],
    });
    vi.mocked(invoke).mockResolvedValueOnce(ws as never);
    const { result } = renderHook(() => useWorkspace());
    await act(async () => {
      await result.current.create("p1", "main", "claude");
    });
    expect(invoke).toHaveBeenCalledWith("workspace_create", {
      projectId: "p1",
      projectPath: "/tmp/p1",
      branch: "main",
      backend: "claude",
      baseBranch: undefined,
    });
    expect(useWorkbench.getState().workspaces).toContainEqual(ws);
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w-new");
  });

  it("create throws when the project is not in the store", async () => {
    useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null, projects: [] });
    const { result } = renderHook(() => useWorkspace());
    await expect(
      act(async () => {
        await result.current.create("missing", "main", "claude");
      })
    ).rejects.toThrow(/project missing not found/);
    expect(invoke).not.toHaveBeenCalled();
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

  it("refreshBackends populates store with installed backends, marks active by defaultBackend", async () => {
    const detected: DetectedBackend[] = [
      { name: "claude-code", command: "claude", installed: true, path: "/usr/local/bin/claude", version: "1.0" },
      { name: "codex", command: "codex", installed: false, path: null, version: null },
      { name: "gemini", command: "gemini", installed: true, path: "/usr/local/bin/gemini", version: "0.5" },
    ];
    const status = {
      ok: true,
      error: null,
      firstRun: false,
      wizardVersion: 1,
      currentWizardVersion: 1,
      paths: { configRoot: "/tmp", dbPath: "/tmp/db", logsDir: "/tmp/logs" },
      settings: {
        schemaVersion: 1,
        wizardVersion: 1,
        firstRunCompletedAt: 123,
        theme: "dark",
        defaultBackend: "gemini",
        notificationsRequestedAt: null,
      },
      notificationPermission: "default",
    } as BootstrapStatus;
    vi.mocked(invoke)
      .mockResolvedValueOnce(detected as never)
      .mockResolvedValueOnce(status as never);
    const { result } = renderHook(() => useWorkspace());
    await act(async () => {
      await result.current.refreshBackends();
    });
    const backends = useWorkbench.getState().backends;
    expect(backends).toHaveLength(2);
    expect(backends.find((b) => b.id === "claude-code")).toMatchObject({
      id: "claude-code",
      name: "Claude Code",
      command: "/usr/local/bin/claude",
      active: false,
    });
    expect(backends.find((b) => b.id === "gemini")).toMatchObject({
      id: "gemini",
      name: "Gemini CLI",
      command: "/usr/local/bin/gemini",
      active: true,
    });
  });

  it("refreshBackends excludes non-installed backends", async () => {
    const detected: DetectedBackend[] = [
      { name: "claude-code", command: "claude", installed: false, path: null, version: null },
    ];
    const status = {
      ok: true, error: null, firstRun: false, wizardVersion: 1, currentWizardVersion: 1,
      paths: { configRoot: "/tmp", dbPath: "/tmp/db", logsDir: "/tmp/logs" },
      settings: { schemaVersion: 1, wizardVersion: 1, firstRunCompletedAt: null, theme: "dark", defaultBackend: null, notificationsRequestedAt: null },
      notificationPermission: "default",
    } as BootstrapStatus;
    vi.mocked(invoke)
      .mockResolvedValueOnce(detected as never)
      .mockResolvedValueOnce(status as never);
    const { result } = renderHook(() => useWorkspace());
    await act(async () => {
      await result.current.refreshBackends();
    });
    expect(useWorkbench.getState().backends).toHaveLength(0);
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
