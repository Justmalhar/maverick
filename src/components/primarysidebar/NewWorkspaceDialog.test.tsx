import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { makeBackend } from "@/test/fixtures";
import { brandFor } from "@/lib/backend-brand";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";

const initial = useWorkbench.getState();

function setBackends(backends = [makeBackend({ id: "claude-code", name: "Claude Code", active: true })]) {
  useWorkbench.setState({ ...initial, backends });
}

function setup(over: Partial<React.ComponentProps<typeof NewWorkspaceDialog>> = {}) {
  const onSubmit = vi.fn();
  const onOpenChange = vi.fn();
  renderWithProviders(
    <NewWorkspaceDialog
      open
      onOpenChange={onOpenChange}
      projectName="demo"
      projectPath={null}
      onSubmit={onSubmit}
      {...over}
    />
  );
  return { onSubmit, onOpenChange };
}

describe("NewWorkspaceDialog — branch naming", () => {
  beforeEach(() => {
    useWorkbench.setState(initial);
  });

  it("Create is disabled until a name is entered", async () => {
    setBackends();
    setup();
    expect(screen.getByTestId("branch-create")).toBeDisabled();
    await userEvent.type(screen.getByTestId("branch-name-input"), "login page");
    expect(screen.getByTestId("branch-create")).toBeEnabled();
  });

  it("composes the chosen type + name and submits it", async () => {
    setBackends();
    const { onSubmit } = setup();
    await userEvent.click(screen.getByTestId("branch-type-fix"));
    await userEvent.type(screen.getByTestId("branch-name-input"), "OAuth Redirect");
    expect(screen.getByTestId("branch-preview")).toHaveTextContent("fix/oauth-redirect");
    await userEvent.click(screen.getByTestId("branch-create"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "fix/oauth-redirect" })
    );
    expect(onSubmit).toHaveBeenCalledWith(expect.not.objectContaining({ aiLater: true }));
  });

  it("'Let AI name it later' submits with aiLater and no branch", async () => {
    setBackends();
    const { onSubmit } = setup();
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ aiLater: true }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.not.objectContaining({ branch: expect.anything() })
    );
  });
});

describe("NewWorkspaceDialog — agent select", () => {
  beforeEach(() => {
    useWorkbench.setState(initial);
  });

  it("defaults to the active backend and submits its id", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [
        makeBackend({ id: "codex", name: "Codex", active: false }),
        makeBackend({ id: "claude-code", name: "Claude Code", active: true }),
      ],
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ backend: "claude-code" }));
  });

  it("changing the agent select changes the submitted backend", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [
        makeBackend({ id: "claude-code", name: "Claude Code", active: true }),
        makeBackend({ id: "codex", name: "Codex", active: false }),
      ],
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    await userEvent.click(screen.getByTestId("agent-select"));
    await userEvent.click(await screen.findByRole("option", { name: /Codex/ }));
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ backend: "codex" }));
  });

  it("falls back to claude-code when no agents are installed", async () => {
    useWorkbench.setState({ ...initial, backends: [] });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    expect(screen.getByTestId("agent-select")).toBeDisabled();
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ backend: "claude-code" }));
    expect(brandFor("claude-code")?.label).toBe("Claude Code");
  });

  it("renders without an icon when the backend id is unrecognised", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "unknown-agent", name: "UnknownAgent", active: true })],
    });
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={vi.fn()} />
    );
    expect(screen.getByTestId("agent-select")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("agent-select"));
    expect(await screen.findByRole("option", { name: /UnknownAgent/ })).toBeInTheDocument();
  });
});
