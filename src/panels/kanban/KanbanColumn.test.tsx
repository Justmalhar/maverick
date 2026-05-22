import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import KanbanColumn from "./KanbanColumn";
import { makeKanbanTask } from "@/test/fixtures";
import type { DiffStat } from "@/lib/ipc";

const emptyCache = new Map<string, DiffStat>();

describe("KanbanColumn", () => {
  it("renders status header, badge count, and triggers onEdit via card click", async () => {
    const onEdit = vi.fn();
    renderWithProviders(
      <KanbanColumn
        status="in_progress"
        tasks={[makeKanbanTask({ id: "t1", title: "x", status: "in_progress" })]}
        diffStatCache={emptyCache}
        onEdit={onEdit}
      />
    );
    expect(screen.getByTestId("kanban-column-in_progress")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("kanban-card-edit"));
    expect(onEdit).toHaveBeenCalled();
  });

  it("renders zero count when tasks empty", () => {
    renderWithProviders(
      <KanbanColumn status="done" tasks={[]} diffStatCache={emptyCache} onEdit={vi.fn()} />
    );
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("passes diffStat to card when workspaceId matches cache", () => {
    const cache = new Map<string, DiffStat>([["ws-1", { added: 5, removed: 2 }]]);
    renderWithProviders(
      <KanbanColumn
        status="in_progress"
        tasks={[makeKanbanTask({ workspaceId: "ws-1", branch: "main", status: "in_progress" })]}
        diffStatCache={cache}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByText("+5")).toBeInTheDocument();
    expect(screen.getByText("-2")).toBeInTheDocument();
  });

  it("renders todo column label", () => {
    renderWithProviders(
      <KanbanColumn status="todo" tasks={[]} diffStatCache={emptyCache} onEdit={vi.fn()} />
    );
    expect(screen.getByText("Todo")).toBeInTheDocument();
  });
});
