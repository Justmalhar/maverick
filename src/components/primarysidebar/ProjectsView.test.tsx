import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { ProjectsView } from "./ProjectsView";
import { useWorkbench } from "@/state/store";
import { makeProject, makeBackend } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, projects: [], backends: [], workspaces: [], activeWorkspaceId: null });
});

describe("ProjectsView", () => {
  it("shows empty state when no projects", () => {
    renderWithProviders(<ProjectsView />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it("renders project list", () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo" })],
      backends: [makeBackend({ id: "claude", name: "claude", active: true })],
    });
    renderWithProviders(<ProjectsView />);
    expect(screen.getByText("demo")).toBeInTheDocument();
  });

  it("clicking add prompts and invokes projectAdd; cancel is a no-op", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    promptSpy.mockReturnValueOnce(null); // cancel
    renderWithProviders(<ProjectsView />);
    await userEvent.click(screen.getByTestId("projects-add"));
    expect(invoke).not.toHaveBeenCalled();

    promptSpy.mockReturnValueOnce("/tmp/proj");
    vi.mocked(invoke).mockResolvedValueOnce(makeProject({ id: "p2", name: "new" }) as never);
    await userEvent.click(screen.getByTestId("projects-add"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("project_add", { path: "/tmp/proj" }));
    promptSpy.mockRestore();
  });

  it("logs an error when projectAdd fails", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValueOnce("/tmp/p");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error("nope"));
    renderWithProviders(<ProjectsView />);
    await userEvent.click(screen.getByTestId("projects-add"));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    promptSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("New workspace → 'AI name later' creates with an undefined branch (sidecar callsign)", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo", path: "/tmp/demo" })],
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") return [] as never;
      if (cmd === "workspace_create") {
        return { id: "w-new", projectId: "p1", branch: "viper", agentBackend: "claude-code", worktreePath: "", status: "active", sessionId: "s", title: "Viper" } as never;
      }
      return undefined as never;
    });
    renderWithProviders(<ProjectsView />);
    await userEvent.click(screen.getByLabelText("New workspace"));
    await userEvent.click(await screen.findByTestId("branch-ai-later"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("workspace_create", {
      projectId: "p1",
      projectPath: "/tmp/demo",
      branch: undefined,
      backend: "claude-code",
      baseBranch: undefined,
    }));
    // Creation queues the setup script to stream in the Panel's Setup tab.
    expect(useWorkbench.getState().pendingSetupIds).toContain("w-new");
    // "AI name later" marks the workspace for an AI rename after its first commit.
    await waitFor(() => expect(useWorkbench.getState().pendingAiRename).toContain("w-new"));
  });

  it("New workspace → typed name creates the composed feature/<slug> branch", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo", path: "/tmp/demo" })],
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") return [] as never;
      if (cmd === "workspace_create") {
        return { id: "w-named", projectId: "p1", branch: "feature/login-page", agentBackend: "claude-code", worktreePath: "", status: "active", sessionId: "s" } as never;
      }
      return undefined as never;
    });
    renderWithProviders(<ProjectsView />);
    await userEvent.click(screen.getByLabelText("New workspace"));
    await userEvent.type(await screen.findByTestId("branch-name-input"), "Login Page");
    await userEvent.click(screen.getByTestId("branch-create"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("workspace_create", {
      projectId: "p1",
      projectPath: "/tmp/demo",
      branch: "feature/login-page",
      backend: "claude-code",
      baseBranch: undefined,
    }));
  });

  it("New workspace → picking a non-default agent creates with that backend", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo", path: "/tmp/demo" })],
      backends: [
        makeBackend({ id: "claude-code", name: "Claude Code", active: true }),
        makeBackend({ id: "codex", name: "Codex", active: false }),
      ],
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") return [] as never;
      if (cmd === "workspace_create") {
        return { id: "w-cx", projectId: "p1", branch: "x", agentBackend: "codex", worktreePath: "", status: "active", sessionId: "s" } as never;
      }
      return undefined as never;
    });
    renderWithProviders(<ProjectsView />);
    await userEvent.click(screen.getByLabelText("New workspace"));
    await userEvent.click(await screen.findByTestId("agent-select"));
    await userEvent.click(await screen.findByRole("option", { name: /Codex/ }));
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("workspace_create", {
      projectId: "p1",
      projectPath: "/tmp/demo",
      branch: undefined,
      backend: "codex",
      baseBranch: undefined,
    }));
  });

  it("logs an error when workspace creation fails", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo" })],
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") return [] as never;
      throw new Error("fail");
    });
    renderWithProviders(<ProjectsView />);
    await userEvent.click(screen.getByLabelText("New workspace"));
    await userEvent.click(await screen.findByTestId("branch-ai-later"));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it("renders project when backend is idle", () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo" })],
      backends: [makeBackend({ id: "claude", name: "claude", active: false })],
    });
    renderWithProviders(<ProjectsView />);
    expect(screen.getByText("demo")).toBeInTheDocument();
  });

  it("onSettings callback opens project settings for that project", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo" })],
      backends: [],
    });
    renderWithProviders(<ProjectsView />);
    await userEvent.click(screen.getByLabelText("Project settings"));
    expect(useWorkbench.getState().projectSettings.open).toBe(true);
    expect(useWorkbench.getState().projectSettings.projectId).toBe("p1");
  });
});
