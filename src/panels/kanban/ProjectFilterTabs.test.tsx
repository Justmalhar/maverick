import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { makeProject } from "@/test/fixtures";
import ProjectFilterTabs from "./ProjectFilterTabs";

const initial = useWorkbench.getState();

describe("ProjectFilterTabs", () => {
  it("renders All projects tab and one tab per project", () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "Alpha" }), makeProject({ id: "p2", name: "Beta" })],
    });
    renderWithProviders(<ProjectFilterTabs filterProjectId={null} onFilterChange={vi.fn()} />);
    expect(screen.getByTestId("filter-all")).toBeInTheDocument();
    expect(screen.getByTestId("filter-project-p1")).toBeInTheDocument();
    expect(screen.getByTestId("filter-project-p2")).toBeInTheDocument();
  });

  it("calls onFilterChange(null) when All projects clicked", async () => {
    useWorkbench.setState({ ...initial, projects: [makeProject({ id: "p1", name: "A" })] });
    const onChange = vi.fn();
    renderWithProviders(<ProjectFilterTabs filterProjectId="p1" onFilterChange={onChange} />);
    await userEvent.click(screen.getByTestId("filter-all"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("calls onFilterChange with project id when tab clicked", async () => {
    useWorkbench.setState({ ...initial, projects: [makeProject({ id: "p1", name: "A" })] });
    const onChange = vi.fn();
    renderWithProviders(<ProjectFilterTabs filterProjectId={null} onFilterChange={onChange} />);
    await userEvent.click(screen.getByTestId("filter-project-p1"));
    expect(onChange).toHaveBeenCalledWith("p1");
  });

  it("overflow projects appear in More menu after 5", () => {
    const projects = Array.from({ length: 7 }, (_, i) =>
      makeProject({ id: `p${i}`, name: `P${i}` })
    );
    useWorkbench.setState({ ...initial, projects });
    renderWithProviders(<ProjectFilterTabs filterProjectId={null} onFilterChange={vi.fn()} />);
    expect(screen.getByTestId("filter-more")).toBeInTheDocument();
    expect(screen.queryByTestId("filter-project-p5")).not.toBeInTheDocument();
    expect(screen.queryByTestId("filter-project-p6")).not.toBeInTheDocument();
  });
});
