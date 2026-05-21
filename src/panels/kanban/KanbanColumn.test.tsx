import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import KanbanColumn from "./KanbanColumn";
import { makeKanbanTask } from "@/test/fixtures";

describe("KanbanColumn", () => {
  it("renders status header, badge, and triggers onEdit via card click", async () => {
    const onEdit = vi.fn();
    renderWithProviders(
      <KanbanColumn
        status="in_progress"
        tasks={[makeKanbanTask({ id: "t1", title: "x" })]}
        onEdit={onEdit}
      />
    );
    expect(screen.getByTestId("kanban-column-in_progress")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("kanban-card-edit"));
    expect(onEdit).toHaveBeenCalled();
  });

  it("renders zero count when tasks empty", () => {
    renderWithProviders(<KanbanColumn status="done" tasks={[]} onEdit={vi.fn()} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
