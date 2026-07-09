import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { makeBackend } from "@/test/fixtures";
import { brandFor } from "@/lib/backend-brand";
import { invoke } from "@tauri-apps/api/core";
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

describe("NewWorkspaceDialog — mode toggle", () => {
  beforeEach(() => {
    useWorkbench.setState(initial);
  });

  it("submits mode: agent when the Agent toggle is selected", async () => {
    setBackends();
    const { onSubmit } = setup();
    await userEvent.click(screen.getByRole("button", { name: /agent/i }));
    await userEvent.type(screen.getByTestId("branch-name-input"), "chat-ui");
    await userEvent.click(screen.getByTestId("branch-create"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: "agent" }));
  });

  it("defaults to terminal mode", async () => {
    setBackends();
    const { onSubmit } = setup();
    await userEvent.type(screen.getByTestId("branch-name-input"), "shell-work");
    await userEvent.click(screen.getByTestId("branch-create"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: "terminal" }));
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

  it("defaults to the first backend when none is marked active", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [
        makeBackend({ id: "codex", name: "Codex", active: false }),
        makeBackend({ id: "gemini", name: "Gemini", active: false }),
      ],
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ backend: "codex" }));
  });

  it("re-derives the active backend when opened after backends load", async () => {
    useWorkbench.setState({ ...initial, backends: [] });
    const onSubmit = vi.fn();
    const { rerender } = renderWithProviders(
      <NewWorkspaceDialog open={false} onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    useWorkbench.setState({
      ...initial,
      backends: [
        makeBackend({ id: "claude-code", name: "Claude Code", active: false }),
        makeBackend({ id: "codex", name: "Codex", active: true }),
      ],
    });
    rerender(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    await userEvent.click(await screen.findByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ backend: "codex" }));
  });

  it("resets the branch name when the dialog is closed and reopened", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    const { rerender } = renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={vi.fn()} />
    );
    await userEvent.type(screen.getByTestId("branch-name-input"), "halfdone");
    rerender(<NewWorkspaceDialog open={false} onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={vi.fn()} />);
    rerender(<NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("branch-name-input")).toHaveValue("");
  });

  it("shows a 'No agents detected' label when no backends are installed", () => {
    useWorkbench.setState({ ...initial, backends: [] });
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={vi.fn()} />
    );
    expect(screen.getByText("No agents detected")).toBeInTheDocument();
  });
});

describe("NewWorkspaceDialog — base branch select", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useWorkbench.setState(initial);
  });

  it("loads branches, defaults to the current branch, and submits it", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") {
        return [
          { name: "main", isRemote: false, isCurrent: false },
          { name: "develop", isRemote: false, isCurrent: true },
          { name: "origin/develop", isRemote: true, isCurrent: false },
        ] as never;
      }
      return undefined as never;
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath="/tmp/demo" onSubmit={onSubmit} />
    );
    await screen.findByText("develop");
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ baseBranch: "develop" }));
  });

  it("leaves baseBranch undefined when projectPath is null", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ baseBranch: undefined }));
  });

  it("disables the select and leaves baseBranch undefined when git_branch_list rejects", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") throw new Error("not a git repo");
      return undefined as never;
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath="/tmp/not-a-repo" onSubmit={onSubmit} />
    );
    // Wait for the async effect to settle (error path sets branches to [])
    await vi.waitFor(() => {
      expect(screen.getByTestId("base-branch-select")).toBeDisabled();
    });
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ baseBranch: undefined }));
  });

  it("leaves base empty when no loaded branch is current", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") {
        return [
          { name: "main", isRemote: false, isCurrent: false },
          { name: "dev", isRemote: false, isCurrent: false },
        ] as never;
      }
      return undefined as never;
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath="/tmp/demo" onSubmit={onSubmit} />
    );
    // Wait for branches to load (select becomes enabled) and then open to verify options exist
    await vi.waitFor(() => {
      expect(screen.getByTestId("base-branch-select")).toBeEnabled();
    });
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ baseBranch: undefined }));
  });

  it("submits the current base branch with a typed branch name via Create", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") {
        return [{ name: "develop", isRemote: false, isCurrent: true }] as never;
      }
      return undefined as never;
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath="/tmp/demo" onSubmit={onSubmit} />
    );
    await screen.findByText("develop");
    await userEvent.type(screen.getByTestId("branch-name-input"), "Login Page");
    await userEvent.click(screen.getByTestId("branch-create"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "feature/login-page", baseBranch: "develop" })
    );
  });

  it("submits on Enter in the branch name input", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    await userEvent.type(screen.getByTestId("branch-name-input"), "Dark Mode{Enter}");
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ branch: "feature/dark-mode" }));
  });

  it("does not submit when Enter is pressed with an empty branch name", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    await userEvent.click(screen.getByTestId("branch-name-input"));
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("ignores the gitBranchList result after the dialog closes (cancels inflight fetch)", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    let resolveList!: (v: unknown) => void;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") {
        return new Promise((res) => { resolveList = res; }) as never;
      }
      return undefined as never;
    });
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={onOpenChange} projectName="demo" projectPath="/tmp/demo" onSubmit={onSubmit} />
    );
    // Close before the list resolves — triggers the cleanup and sets cancelled = true
    rerender(
      <NewWorkspaceDialog open={false} onOpenChange={onOpenChange} projectName="demo" projectPath="/tmp/demo" onSubmit={onSubmit} />
    );
    // Resolve after cancellation — cancelled guard must prevent any setState call
    resolveList([{ name: "main", isRemote: false, isCurrent: true }]);
    // Reopen: since the cancelled effect ran (not the resolve path), branches should be empty
    rerender(
      <NewWorkspaceDialog open onOpenChange={onOpenChange} projectName="demo" projectPath="/tmp/demo" onSubmit={onSubmit} />
    );
    await vi.waitFor(() => {
      expect(screen.getByTestId("base-branch-select")).toBeDisabled();
    });
  });
});
