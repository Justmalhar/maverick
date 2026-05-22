import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWorkbench } from "@/state/store";
import { makeProject, makeWorkspace } from "@/test/fixtures";

vi.mock("@tauri-apps/api/path", () => ({
  desktopDir: vi.fn(async () => "/Users/test/Desktop"),
}));

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({
    ...initial,
    projects: [],
    workspaces: [],
    activeWorkspaceId: null,
  });
});

describe("defaultTerminalCwd", () => {
  it("returns the active workspace's worktreePath when set", async () => {
    useWorkbench.setState({
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt/feature-x" })],
      activeWorkspaceId: "w1",
    });
    const { defaultTerminalCwd } = await import("./default-cwd");
    expect(await defaultTerminalCwd()).toBe("/wt/feature-x");
  });

  it("falls back to first project's path when no active workspace", async () => {
    useWorkbench.setState({
      projects: [makeProject({ id: "p1", path: "/projects/foo" })],
      workspaces: [],
      activeWorkspaceId: null,
    });
    const { defaultTerminalCwd } = await import("./default-cwd");
    expect(await defaultTerminalCwd()).toBe("/projects/foo");
  });

  it("falls back to desktopDir when neither workspace nor project", async () => {
    useWorkbench.setState({ projects: [], workspaces: [], activeWorkspaceId: null });
    const { defaultTerminalCwd } = await import("./default-cwd");
    expect(await defaultTerminalCwd()).toBe("/Users/test/Desktop");
  });
});
