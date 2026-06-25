import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { NameWorkspaceDialog } from "./NameWorkspaceDialog";

function setup(over: Partial<React.ComponentProps<typeof NameWorkspaceDialog>> = {}) {
  const onCreate = vi.fn();
  const onAiLater = vi.fn();
  const onOpenChange = vi.fn();
  renderWithProviders(
    <NameWorkspaceDialog
      open
      onOpenChange={onOpenChange}
      onCreate={onCreate}
      onAiLater={onAiLater}
      {...over}
    />
  );
  return { onCreate, onAiLater, onOpenChange };
}

describe("NameWorkspaceDialog", () => {
  it("Create is disabled until a name is entered", async () => {
    setup();
    expect(screen.getByTestId("branch-create")).toBeDisabled();
    await userEvent.type(screen.getByTestId("branch-name-input"), "login page");
    expect(screen.getByTestId("branch-create")).toBeEnabled();
  });

  it("composes the chosen type + name and shows a live preview", async () => {
    const { onCreate } = setup();
    await userEvent.click(screen.getByTestId("branch-type-fix"));
    await userEvent.type(screen.getByTestId("branch-name-input"), "OAuth Redirect");
    expect(screen.getByTestId("branch-preview")).toHaveTextContent("fix/oauth-redirect");
    await userEvent.click(screen.getByTestId("branch-create"));
    expect(onCreate).toHaveBeenCalledWith("fix/oauth-redirect");
  });

  it("defaults the branch type to feature", async () => {
    const { onCreate } = setup();
    await userEvent.type(screen.getByTestId("branch-name-input"), "dashboard tasks");
    await userEvent.click(screen.getByTestId("branch-create"));
    expect(onCreate).toHaveBeenCalledWith("feature/dashboard-tasks");
  });

  it("'Let AI name it later' fires onAiLater (no name needed)", async () => {
    const { onAiLater, onCreate } = setup();
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onAiLater).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("Enter submits when a name is present", async () => {
    const { onCreate } = setup();
    await userEvent.type(screen.getByTestId("branch-name-input"), "quick fix{Enter}");
    expect(onCreate).toHaveBeenCalledWith("feature/quick-fix");
  });
});
