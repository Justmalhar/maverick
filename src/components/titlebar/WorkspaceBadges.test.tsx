import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { WorkspaceBadges, __testing__ } from "./WorkspaceBadges";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
});

describe("WorkspaceBadges", () => {
  it("renders nothing when no workspaces are open", () => {
    const { container } = renderWithProviders(<WorkspaceBadges />);
    expect(container.querySelector('[data-testid="workspace-badges"]')).toBeNull();
  });

  it("renders one badge per workspace with branch and backend", () => {
    useWorkbench.setState({
      workspaces: [
        makeWorkspace({ id: "a", branch: "feat/a", agentBackend: "claude", status: "active" }),
        makeWorkspace({ id: "b", branch: "feat/b", agentBackend: "codex", status: "idle", title: undefined }),
      ],
      activeWorkspaceId: "a",
    });
    renderWithProviders(<WorkspaceBadges />);
    expect(screen.getByTestId("workspace-badge-a")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-badge-b")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-badge-b")).toHaveTextContent("feat/b");
  });

  it("marks the active workspace badge as pressed", () => {
    useWorkbench.setState({
      workspaces: [makeWorkspace({ id: "a" }), makeWorkspace({ id: "b" })],
      activeWorkspaceId: "b",
    });
    renderWithProviders(<WorkspaceBadges />);
    expect(screen.getByTestId("workspace-badge-b")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("workspace-badge-a")).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking a badge activates that workspace", async () => {
    useWorkbench.setState({
      workspaces: [makeWorkspace({ id: "a" }), makeWorkspace({ id: "b" })],
      activeWorkspaceId: "a",
    });
    renderWithProviders(<WorkspaceBadges />);
    await userEvent.click(screen.getByTestId("workspace-badge-b"));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("b");
  });

  it("uses the title when present, falling back to the branch", () => {
    useWorkbench.setState({
      workspaces: [makeWorkspace({ id: "a", branch: "br", title: "My Title" })],
      activeWorkspaceId: "a",
    });
    renderWithProviders(<WorkspaceBadges />);
    expect(screen.getByTestId("workspace-badge-a")).toHaveTextContent("My Title");
  });

  it("renders a status dot for every status variant", () => {
    useWorkbench.setState({
      workspaces: [
        makeWorkspace({ id: "act", status: "active" }),
        makeWorkspace({ id: "idl", status: "idle" }),
        makeWorkspace({ id: "err", status: "error" }),
      ],
      activeWorkspaceId: "act",
    });
    renderWithProviders(<WorkspaceBadges />);
    expect(screen.getByTestId("workspace-badge-status-act")).toHaveClass(__testing__.STATUS_DOT.active);
    expect(screen.getByTestId("workspace-badge-status-idl")).toHaveClass(__testing__.STATUS_DOT.idle);
    expect(screen.getByTestId("workspace-badge-status-err")).toHaveClass(__testing__.STATUS_DOT.error);
  });

  it("exposes status label map for all variants", () => {
    expect(__testing__.STATUS_LABEL).toEqual({
      active: "Active",
      idle: "Idle",
      error: "Error",
    });
  });
});
