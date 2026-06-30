import { describe, test, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommitActions } from "./CommitActions";

function setup(over: Partial<React.ComponentProps<typeof CommitActions>> = {}) {
  const props = {
    primaryLabel: "Commit & Push" as const,
    canCommit: true,
    busy: false,
    canAgentPr: true,
    onCommit: vi.fn(),
    onCommitAndPush: vi.fn(),
    onPull: vi.fn(),
    onPush: vi.fn(),
    onSync: vi.fn(),
    onCreatePr: vi.fn(),
    onCreatePrWithAgent: vi.fn(),
    onCreateBranch: vi.fn(),
    ...over,
  };
  render(<CommitActions {...props} />);
  return props;
}

describe("CommitActions", () => {
  test("primary button fires Commit & Push", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByTestId("scm-primary"));
    expect(props.onCommitAndPush).toHaveBeenCalled();
  });

  test("primary fires plain Commit when label is Commit", async () => {
    const user = userEvent.setup();
    const props = setup({ primaryLabel: "Commit" });
    await user.click(screen.getByTestId("scm-primary"));
    expect(props.onCommit).toHaveBeenCalled();
  });

  test("menu exposes Push and dispatches it", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByTestId("scm-actions-trigger"));
    await waitFor(() => expect(screen.getByTestId("scm-action-push")).toBeInTheDocument());
    await user.click(screen.getByTestId("scm-action-push"));
    expect(props.onPush).toHaveBeenCalled();
  });

  test("agent PR item is disabled when canAgentPr is false", async () => {
    const user = userEvent.setup();
    setup({ canAgentPr: false });
    await user.click(screen.getByTestId("scm-actions-trigger"));
    await waitFor(() => expect(screen.getByTestId("scm-action-pr-agent")).toBeInTheDocument());
    expect(screen.getByTestId("scm-action-pr-agent")).toHaveAttribute("aria-disabled", "true");
  });
});
