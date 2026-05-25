import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { ProjectItem } from "./ProjectItem";
import { useWorkbench } from "@/state/store";
import { makeProject, makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, projects: [], workspaces: [], activeWorkspaceId: null });
});

describe("ProjectItem", () => {
  it("renders the project name + workspace count and toggles expansion", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
    });
    renderWithProviders(<ProjectItem project={makeProject({ id: "p1", name: "demo" })} />);
    expect(screen.getByText("demo")).toBeInTheDocument();

    // Collapse and re-expand
    const expandBtn = screen.getByRole("button", { expanded: true });
    await userEvent.click(expandBtn);
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
  });

  it("shows the no-workspaces placeholder when none", () => {
    renderWithProviders(<ProjectItem project={makeProject({ id: "p1", name: "empty" })} />);
    expect(screen.getByText("No workspaces")).toBeInTheDocument();
  });

  it("calls onAddWorkspace via the plus button", async () => {
    const onAdd = vi.fn();
    renderWithProviders(<ProjectItem project={makeProject({ id: "p1" })} onAddWorkspace={onAdd} />);
    await userEvent.click(screen.getByLabelText("New workspace"));
    expect(onAdd).toHaveBeenCalledWith("p1");
  });

  it("plus click is a no-op when callback omitted", async () => {
    renderWithProviders(<ProjectItem project={makeProject({ id: "p1" })} />);
    await userEvent.click(screen.getByLabelText("New workspace"));
  });

  it("calls onSettings via the project settings button", async () => {
    const onSettings = vi.fn();
    renderWithProviders(<ProjectItem project={makeProject({ id: "p1" })} onSettings={onSettings} />);
    await userEvent.click(screen.getByLabelText("Project settings"));
    expect(onSettings).toHaveBeenCalledWith("p1");
  });

  it("calls onCreateFrom via the create-from button", async () => {
    const onCreateFrom = vi.fn();
    renderWithProviders(<ProjectItem project={makeProject({ id: "p1" })} onCreateFrom={onCreateFrom} />);
    await userEvent.click(screen.getByLabelText("Create from"));
    expect(onCreateFrom).toHaveBeenCalledWith("p1");
  });
});
