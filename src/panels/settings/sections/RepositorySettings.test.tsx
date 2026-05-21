import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import RepositorySettings from "./RepositorySettings";
import { useWorkbench } from "@/state/store";
import { makeProject } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, projects: [] });
});

describe("RepositorySettings", () => {
  it("shows empty state when no projects", () => {
    renderWithProviders(<RepositorySettings />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText(/Select a repository on the left/)).toBeInTheDocument();
  });

  it("selects between projects", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [
        makeProject({ id: "p1", name: "A" }),
        makeProject({ id: "p2", name: "B" }),
      ],
    });
    renderWithProviders(<RepositorySettings />);
    await userEvent.click(screen.getByTestId("repo-p2"));
    expect(screen.getByTestId("repo-config")).toBeInTheDocument();
  });
});
