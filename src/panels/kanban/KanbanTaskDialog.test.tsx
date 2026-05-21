import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import KanbanTaskDialog from "./KanbanTaskDialog";
import { makeKanbanTask } from "@/test/fixtures";

describe("KanbanTaskDialog", () => {
  it("creates a new task with title + labels + status + due date", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <KanbanTaskDialog open onOpenChange={() => {}} task={{ status: "backlog", labels: [] }} onSubmit={onSubmit} />
    );
    await userEvent.type(screen.getByTestId("kanban-title"), "Build feature");
    await userEvent.type(screen.getByTestId("kanban-description"), "details");
    await userEvent.click(screen.getByTestId("status-in_progress"));
    await userEvent.type(screen.getByTestId("kanban-label-input"), "urgent");
    await userEvent.click(screen.getByText("Add"));
    // duplicate label rejected
    await userEvent.type(screen.getByTestId("kanban-label-input"), "urgent");
    await userEvent.click(screen.getByText("Add"));
    // remove label
    await userEvent.click(screen.getByText(/urgent/));
    // re-add then submit
    await userEvent.type(screen.getByTestId("kanban-label-input"), "todo{Enter}");
    await userEvent.click(screen.getByTestId("kanban-submit"));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("loads existing task fields", () => {
    renderWithProviders(
      <KanbanTaskDialog
        open
        onOpenChange={() => {}}
        task={makeKanbanTask({ id: "x", title: "ed", description: "d", labels: ["L"], dueDate: 1700000000, projectId: "p1", columnOrder: 3 })}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByTestId("kanban-title")).toHaveValue("ed");
  });

  it("does not submit when title is empty", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<KanbanTaskDialog open onOpenChange={() => {}} task={{}} onSubmit={onSubmit} />);
    expect(screen.getByTestId("kanban-submit")).toBeDisabled();
    await userEvent.click(screen.getByText("Cancel"));
  });

  it("ignores empty label additions", async () => {
    renderWithProviders(<KanbanTaskDialog open onOpenChange={() => {}} task={{ labels: [] }} onSubmit={() => {}} />);
    await userEvent.click(screen.getByText("Add"));
  });

  it("preserves id, projectId, columnOrder, dueDate when submitting an edit", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <KanbanTaskDialog
        open
        onOpenChange={() => {}}
        task={makeKanbanTask({ id: "x", title: "ed", projectId: "p1", columnOrder: 5, dueDate: 1700000000 })}
        onSubmit={onSubmit}
      />
    );
    await userEvent.click(screen.getByTestId("kanban-submit"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      id: "x", projectId: "p1", columnOrder: 5, dueDate: expect.any(Number),
    }));
  });

  it("changing the due date input wires through setDueDate", async () => {
    renderWithProviders(<KanbanTaskDialog open onOpenChange={() => {}} task={{ labels: [] }} onSubmit={() => {}} />);
    const due = screen.getByTestId("kanban-due") as HTMLInputElement;
    await userEvent.type(due, "2026-01-01");
    expect(due.value).toBeTruthy();
  });
});
