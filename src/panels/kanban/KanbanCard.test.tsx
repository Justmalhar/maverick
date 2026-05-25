import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import KanbanCard from "./KanbanCard";
import { useWorkbench } from "@/state/store";
import { makeBackend, makeKanbanTask, makeWorkspace } from "@/test/fixtures";
import type { DiffStat } from "@/lib/ipc";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, backends: [], workspaces: [], activeWorkspaceId: null });
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
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-new", projectId: "p1", branch: "main", agentBackend: "claude",
      worktreePath: "", status: "active", sessionId: "s",
    } as never);
    renderWithProviders(<KanbanCard task={makeKanbanTask({ projectId: "p1" })} index={0} onEdit={() => {}} />);
    await userEvent.click(screen.getByTestId("kanban-start"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("workspace_create", expect.any(Object)));
  });

  it("logs an error when start fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no"));
    renderWithProviders(<KanbanCard task={makeKanbanTask()} index={0} onEdit={() => {}} />);
    await userEvent.click(screen.getByTestId("kanban-start"));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
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

  it("renders green agent dot for in_progress", () => {
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "in_progress", branch: "main" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByTestId("agent-dot")).toHaveClass("bg-amber-400");
  });

  it("renders amber dot for review", () => {
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "review", branch: "main" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByTestId("agent-dot")).toHaveClass("bg-emerald-400");
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

  it("shows no action button for done status", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ status: "done" })} index={0} onEdit={vi.fn()} />
    );
    expect(screen.queryByTestId("kanban-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kanban-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kanban-create-pr")).not.toBeInTheDocument();
  });

  it("startInMaverick falls back to 'claude' when backends list is empty and task has no agentBackend", async () => {
    useWorkbench.setState({ ...initial, backends: [] });
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
});
