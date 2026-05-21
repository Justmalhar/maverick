import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { WorkspaceItem } from "./WorkspaceItem";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
});

describe("WorkspaceItem", () => {
  it("renders title or branch fallback and updates active workspace on click", async () => {
    renderWithProviders(<WorkspaceItem workspace={makeWorkspace({ id: "w1", title: undefined, branch: "feat", status: "idle" })} />);
    const btn = screen.getByTestId("workspace-item-w1");
    expect(btn).toHaveTextContent("feat");
    await userEvent.click(btn);
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w1");
  });

  it("renders title when provided and reflects active state", () => {
    useWorkbench.setState({ ...initial, activeWorkspaceId: "w1" });
    renderWithProviders(<WorkspaceItem workspace={makeWorkspace({ id: "w1", title: "Hello", status: "error" })} />);
    expect(screen.getByTestId("workspace-item-w1")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});
