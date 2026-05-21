import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import KanbanBoard from "./KanbanBoard";
import { useWorkbench } from "@/state/store";
import { makeKanbanTask, makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
});

describe("KanbanBoard", () => {
  it("shows empty state when no active project", () => {
    renderWithProviders(<KanbanBoard />);
    expect(screen.getByTestId("kanban-empty")).toBeInTheDocument();
  });

  it("renders columns and tasks; opens new + edit dialogs (covers onEdit closure)", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockResolvedValueOnce([
      makeKanbanTask({ id: "t1", projectId: "p1", status: "backlog" }),
    ] as never);
    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("kanban-card-edit"));
    expect(screen.getByTestId("kanban-task-dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Cancel"));
    await userEvent.click(screen.getByTestId("kanban-add"));
    expect(screen.getByTestId("kanban-task-dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Cancel"));
  });

  it("upsert success refreshes", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(makeKanbanTask() as never)
      .mockResolvedValueOnce([] as never);
    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("kanban-add"));
    const titleInput = await screen.findByTestId("kanban-title");
    await userEvent.type(titleInput, "T");
    await userEvent.click(screen.getByTestId("kanban-submit"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("kanban_upsert", expect.any(Object)));
  });

  it("upsert error surfaces", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockResolvedValueOnce([] as never).mockRejectedValueOnce(new Error("u-fail"));
    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("kanban-add"));
    const titleInput = await screen.findByTestId("kanban-title");
    await userEvent.type(titleInput, "x");
    await userEvent.click(screen.getByTestId("kanban-submit"));
    await waitFor(() => expect(screen.getByText(/u-fail/)).toBeInTheDocument());
  });

  it("captures refresh errors", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("listfail"));
    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByText(/listfail/)).toBeInTheDocument());
  });

  it("onDragEnd reorders tasks and persists; ignores null destination + missing task", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    const t1 = makeKanbanTask({ id: "t1", projectId: "p1", status: "backlog", columnOrder: 0 });
    const t2 = makeKanbanTask({ id: "t2", projectId: "p1", status: "backlog", columnOrder: 1 });
    const t3 = makeKanbanTask({ id: "t3", projectId: "p1", status: "in_progress", columnOrder: 0 });
    const t4 = makeKanbanTask({ id: "t4", projectId: "p1", status: "done", columnOrder: 0 });
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "kanban_list") return [t1, t2, t3, t4];
      if (cmd === "kanban_upsert") return t1;
      return undefined;
    }) as unknown as typeof invoke);
    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());

    const onDragEnd = (globalThis as Record<string, unknown>).__dndOnDragEnd as (r: unknown) => Promise<void>;

    // No destination → early return
    await onDragEnd({ source: { droppableId: "backlog", index: 0 }, destination: null, draggableId: "t1" });

    // Unknown task id → early return
    await onDragEnd({
      source: { droppableId: "backlog", index: 0 },
      destination: { droppableId: "in_progress", index: 0 },
      draggableId: "missing",
    });

    // Real move t1 from "backlog" to "in_progress" — t2 stays in src (covers line 70-73),
    // t3 in dest (covers line 74-77), t4 in "done" (covers line 78 return t).
    await onDragEnd({
      source: { droppableId: "backlog", index: 0 },
      destination: { droppableId: "in_progress", index: 0 },
      draggableId: "t1",
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("kanban_upsert", expect.any(Object)));
  });

  it("onDragEnd surfaces upsert errors and refreshes", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    const t1 = makeKanbanTask({ id: "t1", projectId: "p1", status: "backlog" });
    let listCalls = 0;
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "kanban_list") {
        listCalls += 1;
        if (listCalls === 1) return [t1];
        // Second call (refresh after upsert failure) also rejects so error stays visible.
        return Promise.reject(new Error("refresh-fail"));
      }
      if (cmd === "kanban_upsert") return Promise.reject(new Error("upfail"));
      return undefined;
    }) as unknown as typeof invoke);
    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());
    const onDragEnd = (globalThis as Record<string, unknown>).__dndOnDragEnd as (r: unknown) => Promise<void>;
    await onDragEnd({
      source: { droppableId: "backlog", index: 0 },
      destination: { droppableId: "review", index: 0 },
      draggableId: "t1",
    });
    await waitFor(() => expect(screen.getByText(/refresh-fail|upfail/)).toBeInTheDocument());
  });
});
