import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { makeBackend } from "@/test/fixtures";
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
