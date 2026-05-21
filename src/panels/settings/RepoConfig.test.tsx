import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import RepoConfig from "./RepoConfig";
import { makeProject } from "@/test/fixtures";

describe("RepoConfig", () => {
  it("renders + edits all repo fields and switches tabs", async () => {
    renderWithProviders(<RepoConfig project={makeProject({ id: "p1", name: "demo", path: "/p" })} />);
    expect(screen.getByText("demo")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("repo-worktrees"), { target: { value: "/wt" } });
    fireEvent.change(screen.getByTestId("repo-base-branch"), { target: { value: "main" } });

    await userEvent.click(screen.getByTestId("repo-tab-scripts"));
    fireEvent.change(screen.getByTestId("repo-setup"), { target: { value: "bun i" } });
    fireEvent.change(screen.getByTestId("repo-run"), { target: { value: "bun dev" } });
    fireEvent.change(screen.getByTestId("repo-test"), { target: { value: "bun t" } });

    await userEvent.click(screen.getByTestId("repo-tab-ai"));
    fireEvent.change(screen.getByTestId("repo-backend"), { target: { value: "codex" } });

    await userEvent.click(screen.getByTestId("repo-tab-instructions"));
    fireEvent.change(screen.getByTestId("repo-instructions-file"), { target: { value: "AGENTS.md" } });
    fireEvent.change(screen.getByTestId("repo-instructions"), { target: { value: "y".repeat(17000) } });
    expect(screen.getByText(/Warning/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("repo-save"));
  });

  it("resets state when project id changes", () => {
    const { rerender } = renderWithProviders(<RepoConfig project={makeProject({ id: "p1" })} />);
    rerender(<RepoConfig project={makeProject({ id: "p2", name: "other", path: "/other" })} />);
    expect(screen.getByText("other")).toBeInTheDocument();
  });
});
