import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { WorkspaceItem } from "./WorkspaceItem";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
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

  it("archive button asks for confirmation and is a no-op on cancel", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const ws = makeWorkspace({ id: "w1", title: "Polaris" });
    useWorkbench.setState({ ...initial, workspaces: [ws], activeWorkspaceId: null });
    renderWithProviders(<WorkspaceItem workspace={ws} />);
    await userEvent.click(screen.getByTestId("workspace-archive-w1"));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Polaris"));
    expect(invoke).not.toHaveBeenCalledWith("workspace_destroy", expect.anything());
    expect(useWorkbench.getState().workspaces).toHaveLength(1);
    confirmSpy.mockRestore();
  });

  it("archive destroys the workspace and removes it from the store", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    const ws = makeWorkspace({ id: "w1", title: "Polaris" });
    useWorkbench.setState({ ...initial, workspaces: [ws], activeWorkspaceId: null });
    renderWithProviders(<WorkspaceItem workspace={ws} />);
    await userEvent.click(screen.getByTestId("workspace-archive-w1"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("workspace_destroy", { workspaceId: "w1" })
    );
    expect(useWorkbench.getState().workspaces).toHaveLength(0);
    // The archive click must not also activate the workspace.
    expect(useWorkbench.getState().activeWorkspaceId).toBeNull();
    confirmSpy.mockRestore();
  });

  it("archive failure keeps the workspace and raises a notification", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_destroy") throw new Error("archive script exited 1");
      return undefined as never;
    });
    const ws = makeWorkspace({ id: "w1", title: "Polaris" });
    useWorkbench.setState({ ...initial, workspaces: [ws], activeWorkspaceId: null });
    renderWithProviders(<WorkspaceItem workspace={ws} />);
    await userEvent.click(screen.getByTestId("workspace-archive-w1"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "notify_send",
        expect.objectContaining({
          title: "Archive failed",
          body: expect.stringContaining("archive script exited 1"),
          workspaceId: "w1",
        })
      )
    );
    expect(useWorkbench.getState().workspaces).toHaveLength(1);
    confirmSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("activates the workspace via keyboard", async () => {
    const ws = makeWorkspace({ id: "w1", title: "Polaris" });
    useWorkbench.setState({ ...initial, workspaces: [ws], activeWorkspaceId: null });
    renderWithProviders(<WorkspaceItem workspace={ws} />);
    screen.getByTestId("workspace-item-w1").focus();
    await userEvent.keyboard("{Enter}");
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w1");
  });
});