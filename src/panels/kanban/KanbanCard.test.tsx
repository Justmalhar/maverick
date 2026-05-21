import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import KanbanCard from "./KanbanCard";
import { useWorkbench } from "@/state/store";
import { makeBackend, makeKanbanTask } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, backends: [], workspaces: [], activeWorkspaceId: null });
});

describe("KanbanCard", () => {
  it("renders title, labels, due date, and triggers edit", async () => {
    const onEdit = vi.fn();
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({
          id: "t1", title: "Hello", description: "**bold**",
          labels: ["a", "b"], dueDate: 1700000000, workspaceId: "w-ref",
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
});
