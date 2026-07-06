import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { fireEvent, renderWithProviders, screen, waitFor } from "@/test/utils";
import KanbanCard from "./KanbanCard";
import { useWorkbench } from "@/state/store";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";
import { makeBackend, makeKanbanTask, makeProject, makeWorkspace } from "@/test/fixtures";
import type { DiffStat } from "@/lib/ipc";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, backends: [], workspaces: [], activeWorkspaceId: null });
  useAgentStatusStore.setState({ statuses: {} });
});

describe("KanbanCard", () => {
  it("renders title, labels, and triggers edit", async () => {
    const onEdit = vi.fn();
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({
          id: "t1", title: "Hello", description: "**bold**",
          labels: ["a", "b"], workspaceId: "w-ref",
        })}
        index={0}
        onEdit={onEdit}
      />
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("kanban-card-edit"));
    expect(onEdit).toHaveBeenCalled();
  });

  it("startInMaverick uses active backend then default fallback", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude", active: false })],
      projects: [makeProject({ id: "p1", path: "/tmp/p1" })],
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-new", projectId: "p1", branch: "main", agentBackend: "claude",
      worktreePath: "", status: "active", sessionId: "s",
    } as never);
    renderWithProviders(<KanbanCard task={makeKanbanTask({ projectId: "p1" })} index={0} onEdit={() => {}} />);
    await userEvent.click(screen.getByTestId("kanban-start"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "workspace_create",
      expect.objectContaining({ projectId: "p1", projectPath: "/tmp/p1" })
    ));
  });

  it("logs an error when start fails", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "proj-1", path: "/tmp/proj-1" })],
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no"));
    renderWithProviders(<KanbanCard task={makeKanbanTask()} index={0} onEdit={() => {}} />);
    await userEvent.click(screen.getByTestId("kanban-start"));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it("logs an error when the project is missing from the store", async () => {
    useWorkbench.setState({ ...initial, projects: [] });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ projectId: "ghost" })} index={0} onEdit={() => {}} />
    );
    await userEvent.click(screen.getByTestId("kanban-start"));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    expect(invoke).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("shows branch and diff stats when workspaceId and diffStat provided", () => {
    const diffStat: DiffStat = { added: 42, removed: 7 };
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ branch: "feat/foo", workspaceId: "ws-1" })}
        index={0}
        diffStat={diffStat}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByText("feat/foo")).toBeInTheDocument();
    expect(screen.getByText("+42")).toBeInTheDocument();
    expect(screen.getByText("-7")).toBeInTheDocument();
  });

  it("hides diff stats row when no branch set", () => {
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ branch: "" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    expect(screen.queryByTestId("agent-dot")).not.toBeInTheDocument();
  });

  it("renders warning agent dot for in_progress", () => {
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "in_progress", branch: "main" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByTestId("agent-dot")).toHaveClass("bg-warning");
  });

  it("shows the live agent status pill (not the static dot) for an in_progress task with a linked workspace", () => {
    useAgentStatusStore.setState({ statuses: { "ws-1": "attention" } });
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "in_progress", branch: "main", workspaceId: "ws-1" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByTestId("agent-status-pill")).toHaveAttribute("data-status", "attention");
    expect(screen.queryByTestId("agent-dot")).not.toBeInTheDocument();
  });

  it("renders success dot for review", () => {
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "review", branch: "main" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByTestId("agent-dot")).toHaveClass("bg-success");
  });

  it("shows Start button for todo status", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ status: "todo" })} index={0} onEdit={vi.fn()} />
    );
    expect(screen.getByTestId("kanban-start")).toBeInTheDocument();
  });

  it("shows View button for in_progress status", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ status: "in_progress" })} index={0} onEdit={vi.fn()} />
    );
    expect(screen.getByTestId("kanban-view")).toBeInTheDocument();
  });

  it("shows Create PR button for review status", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ status: "review" })} index={0} onEdit={vi.fn()} />
    );
    expect(screen.getByTestId("kanban-create-pr")).toBeInTheDocument();
  });

  it("Create PR pushes the branch and opens the returned url", async () => {
    const { open } = await import("@tauri-apps/plugin-shell");
    vi.mocked(open).mockClear();
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "ws-rev", worktreePath: "/wt/rev" })],
    });
    vi.mocked(invoke).mockResolvedValueOnce({ url: "https://example.com/pr/1" } as never);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "review", title: "My change", workspaceId: "ws-rev" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    await userEvent.click(screen.getByTestId("kanban-create-pr"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pr_create",
        expect.objectContaining({ worktreePath: "/wt/rev", title: "My change" })
      )
    );
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://example.com/pr/1"));
    confirmSpy.mockRestore();
  });

  it("Create PR is disabled when the task has no linked workspace", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ status: "review", workspaceId: undefined })} index={0} onEdit={vi.fn()} />
    );
    expect(screen.getByTestId("kanban-create-pr")).toBeDisabled();
  });

  it("Create PR surfaces an error when prCreate fails", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "ws-rev", worktreePath: "/wt/rev" })],
    });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("push rejected"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "review", workspaceId: "ws-rev" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    await userEvent.click(screen.getByTestId("kanban-create-pr"));
    await waitFor(() => expect(screen.getByTestId("kanban-start-error").textContent).toContain("push rejected"));
    confirmSpy.mockRestore();
  });

  it("Create PR does nothing when the confirm prompt is dismissed", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "ws-rev", worktreePath: "/wt/rev" })],
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "review", workspaceId: "ws-rev" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    await userEvent.click(screen.getByTestId("kanban-create-pr"));
    expect(invoke).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("shows no action button for done status", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ status: "done" })} index={0} onEdit={vi.fn()} />
    );
    expect(screen.queryByTestId("kanban-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kanban-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kanban-create-pr")).not.toBeInTheDocument();
  });

  it("startInMaverick falls back to 'claude' when backends list is empty and task has no agentBackend", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [],
      projects: [makeProject({ id: "p1", path: "/tmp/p1" })],
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-new", projectId: "p1", branch: "main", agentBackend: "claude",
      worktreePath: "", status: "active", sessionId: "s",
    } as never);
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ projectId: "p1", agentBackend: "" })} index={0} onEdit={() => {}} />
    );
    await userEvent.click(screen.getByTestId("kanban-start"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("workspace_create", expect.objectContaining({ backend: "claude" }))
    );
  });

  it("viewWorkspace sets the active workspace when clicked", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "ws-active" })],
      activeWorkspaceId: null,
    });
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "in_progress", workspaceId: "ws-active" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    await userEvent.click(screen.getByTestId("kanban-view"));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("ws-active");
  });

  it("View surfaces an error instead of silently no-opping when the workspace is gone", async () => {
    useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "in_progress", workspaceId: "ws-missing" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    await userEvent.click(screen.getByTestId("kanban-view"));
    expect(screen.getByTestId("kanban-start-error").textContent).toContain("no longer available");
    expect(useWorkbench.getState().activeWorkspaceId).toBeNull();
  });

  it("calls onStart prop with the task when provided", async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const task = makeKanbanTask({ id: "t-start", projectId: "p1" });
    renderWithProviders(
      <KanbanCard task={task} index={0} onEdit={vi.fn()} onStart={onStart} />
    );
    await userEvent.click(screen.getByTestId("kanban-start"));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith(task));
    // Should NOT call invoke directly when onStart is provided
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows error on card when onStart throws", async () => {
    const onStart = vi.fn().mockRejectedValue(new Error("start-boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ projectId: "p1" })}
        index={0}
        onEdit={vi.fn()}
        onStart={onStart}
      />
    );
    await userEvent.click(screen.getByTestId("kanban-start"));
    await waitFor(() =>
      expect(screen.getByTestId("kanban-start-error")).toBeInTheDocument()
    );
    expect(screen.getByTestId("kanban-start-error").textContent).toContain("start-boom");
    errSpy.mockRestore();
  });

  it("Start button is disabled when task has no projectId", () => {
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "todo", projectId: "" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByTestId("kanban-start")).toBeDisabled();
  });

  it("Start button is not shown when task is done", () => {
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "done", projectId: "p1" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    expect(screen.queryByTestId("kanban-start")).not.toBeInTheDocument();
  });

  it("renders no actions menu when onDelete is not provided", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "t1" })} index={0} onEdit={vi.fn()} />
    );
    expect(screen.queryByTestId("kanban-card-menu")).not.toBeInTheDocument();
  });

  it("renders the three-dot actions menu when onDelete is provided", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "t1" })} index={0} onEdit={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByTestId("kanban-card-menu")).toBeInTheDocument();
  });

  it("three-dot menu Delete calls onDelete with the task id after confirm", async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "del-1" })} index={0} onEdit={vi.fn()} onDelete={onDelete} />
    );
    await userEvent.click(screen.getByTestId("kanban-card-menu"));
    await userEvent.click(await screen.findByTestId("kanban-menu-delete"));
    expect(onDelete).toHaveBeenCalledWith("del-1");
    confirmSpy.mockRestore();
  });

  it("three-dot menu Delete does nothing when confirm is dismissed", async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "del-2" })} index={0} onEdit={vi.fn()} onDelete={onDelete} />
    );
    await userEvent.click(screen.getByTestId("kanban-card-menu"));
    await userEvent.click(await screen.findByTestId("kanban-menu-delete"));
    expect(onDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("three-dot menu Edit item calls onEdit", async () => {
    const onEdit = vi.fn();
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "t1" })} index={0} onEdit={onEdit} onDelete={vi.fn()} />
    );
    await userEvent.click(screen.getByTestId("kanban-card-menu"));
    await userEvent.click(await screen.findByTestId("kanban-menu-edit"));
    expect(onEdit).toHaveBeenCalled();
  });

  it("right-click opens the context menu and Delete calls onDelete", async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "ctx-1" })} index={0} onEdit={vi.fn()} onDelete={onDelete} />
    );
    fireEvent.contextMenu(screen.getByTestId("kanban-card"));
    await userEvent.click(await screen.findByTestId("kanban-menu-delete"));
    expect(onDelete).toHaveBeenCalledWith("ctx-1");
    confirmSpy.mockRestore();
  });

  it("right-click context menu Edit item calls onEdit", async () => {
    const onEdit = vi.fn();
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "ctx-edit" })} index={0} onEdit={onEdit} onDelete={vi.fn()} />
    );
    fireEvent.contextMenu(screen.getByTestId("kanban-card"));
    await userEvent.click(await screen.findByTestId("kanban-menu-edit"));
    expect(onEdit).toHaveBeenCalled();
  });

  it("right-click context menu Delete does nothing when confirm is dismissed", async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ id: "ctx-2" })} index={0} onEdit={vi.fn()} onDelete={onDelete} />
    );
    fireEvent.contextMenu(screen.getByTestId("kanban-card"));
    await userEvent.click(await screen.findByTestId("kanban-menu-delete"));
    expect(onDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
