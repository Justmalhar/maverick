import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { WorkspaceItem, formatDiffCount } from "./WorkspaceItem";
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

  it("activates on Space and prevents the default page scroll", () => {
    const ws = makeWorkspace({ id: "w2", title: "Vega" });
    useWorkbench.setState({ ...initial, workspaces: [ws], activeWorkspaceId: null });
    renderWithProviders(<WorkspaceItem workspace={ws} />);
    // fireEvent returns false when a handler called preventDefault on the event.
    const notCancelled = fireEvent.keyDown(screen.getByTestId("workspace-item-w2"), { key: " " });
    expect(notCancelled).toBe(false);
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w2");
  });

  it("renders the diff count once git_diff_stat resolves", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_diff_stat") return { added: 2847, removed: 1 } as never;
      return undefined as never;
    });
    const ws = makeWorkspace({ id: "w1", title: "Polaris" });
    renderWithProviders(<WorkspaceItem workspace={ws} />);
    const diff = await screen.findByTestId("workspace-diff-w1");
    expect(diff).toHaveTextContent("+2.8k");
    expect(diff).toHaveTextContent("−1");
  });

  it("omits the diff count when there are no changes", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_diff_stat") return { added: 0, removed: 0 } as never;
      return undefined as never;
    });
    const ws = makeWorkspace({ id: "w1", title: "Polaris" });
    renderWithProviders(<WorkspaceItem workspace={ws} />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("git_diff_stat", { worktreePath: ws.worktreePath })
    );
    expect(screen.queryByTestId("workspace-diff-w1")).not.toBeInTheDocument();
  });

  it("renders only the additions when nothing was removed", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_diff_stat") return { added: 5, removed: 0 } as never;
      return undefined as never;
    });
    const ws = makeWorkspace({ id: "w1", title: "Polaris" });
    renderWithProviders(<WorkspaceItem workspace={ws} />);
    const diff = await screen.findByTestId("workspace-diff-w1");
    expect(diff).toHaveTextContent("+5");
    expect(diff).not.toHaveTextContent("−");
  });

  it("ignores a git_diff_stat failure without surfacing an error", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_diff_stat") throw new Error("not a git repo");
      return undefined as never;
    });
    const ws = makeWorkspace({ id: "w1", title: "Polaris" });
    renderWithProviders(<WorkspaceItem workspace={ws} />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("git_diff_stat", { worktreePath: ws.worktreePath })
    );
    expect(screen.queryByTestId("workspace-diff-w1")).not.toBeInTheDocument();
  });
});

describe("formatDiffCount", () => {
  it("returns raw counts below 1000", () => {
    expect(formatDiffCount(0)).toBe("0");
    expect(formatDiffCount(999)).toBe("999");
  });

  it("uses one decimal for thousands under 10k", () => {
    expect(formatDiffCount(1000)).toBe("1.0k");
    expect(formatDiffCount(2847)).toBe("2.8k");
  });

  it("rounds to a whole number at 10k and above", () => {
    expect(formatDiffCount(10500)).toBe("11k");
    expect(formatDiffCount(123456)).toBe("123k");
  });
});