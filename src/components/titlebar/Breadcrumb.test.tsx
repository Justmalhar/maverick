import { describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { Breadcrumb } from "./Breadcrumb";
import { useWorkbench } from "@/state/store";
import { makeProject, makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({
    ...initial, projects: [], workspaces: [], activeWorkspaceId: null,
  });
});

describe("Breadcrumb", () => {
  it("renders the empty state without an active workspace", () => {
    renderWithProviders(<Breadcrumb className="bc" />);
    expect(screen.getByTestId("breadcrumb-empty")).toHaveTextContent("Maverick");
    expect(screen.getByTestId("breadcrumb-empty").className).toMatch(/bc/);
  });

  it("renders project + branch + backend chips with an active workspace", () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1", branch: "feature", agentBackend: "codex" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<Breadcrumb />);
    expect(screen.getByTestId("breadcrumb")).toHaveTextContent("demo");
    expect(screen.getByTestId("breadcrumb")).toHaveTextContent("feature");
    expect(screen.getByTestId("breadcrumb")).toHaveTextContent("codex");
  });

  it("falls back to 'Project' label when project is missing", () => {
    useWorkbench.setState({
      ...initial,
      projects: [],
      workspaces: [makeWorkspace({ id: "w1", projectId: "absent" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<Breadcrumb />);
    expect(screen.getByTestId("breadcrumb")).toHaveTextContent("Project");
  });
});
