import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, waitFor, fireEvent } from "@/test/utils";
import { BottomTerminal, killBottomPty, __testing__ } from "./BottomTerminal";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";
import { _resetSettingsStoreForTests, useSettingsStore } from "@/lib/stores/settings";
import { TerminalRegistry, type TerminalHandle, type TerminalProvider } from "@/lib/terminal-provider";

const initial = useWorkbench.getState();

function registerStubProvider(): TerminalHandle {
  const handle: TerminalHandle = {
    write: vi.fn(),
    onData: vi.fn(() => () => {}), onResize: vi.fn(() => () => {}),
    resize: vi.fn(),
    setTheme: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    get dimensions() {
      return { cols: 80, rows: 24 };
    },
  };
  const provider: TerminalProvider = { mount: () => handle };
  TerminalRegistry.register(provider);
  return handle;
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(listen).mockReset().mockResolvedValue(() => {});
  __testing__.ptyCache.clear();
  useWorkbench.setState({
    ...initial,
    workspaces: [],
    activeWorkspaceId: null,
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  _resetSettingsStoreForTests();
});

describe("BottomTerminal", () => {
  it("renders empty state when no active workspace", () => {
    renderWithProviders(<BottomTerminal />);
    expect(screen.getByTestId("bottom-terminal-empty")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("spawns a pty in the worktree and renders the TerminalPane", async () => {
    registerStubProvider();
    const ws = makeWorkspace({ id: "ws-1", worktreePath: "/p/wt" });
    useWorkbench.setState({
      ...initial,
      workspaces: [ws],
      activeWorkspaceId: "ws-1",
    });
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-1" } as never);

    renderWithProviders(<BottomTerminal />);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_spawn", {
        command: "/bin/zsh",
        args: ["-l"],
        cwd: "/p/wt",
        env: {},
      })
    );
    expect(await screen.findByTestId("bottom-terminal")).toBeInTheDocument();
    // Focusing the pane exercises the no-op onFocus handler without throwing.
    fireEvent.mouseDown(screen.getByTestId("terminal-pane-bottom-ws-1"));
  });

  it("threads the global env into the shell spawn", async () => {
    registerStubProvider();
    useSettingsStore.setState({ values: { "general.env": JSON.stringify({ TOK: "z" }) } });
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "ws-e", worktreePath: "/p/e" })],
      activeWorkspaceId: "ws-e",
    });
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-e" } as never);
    renderWithProviders(<BottomTerminal />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ env: { TOK: "z" } })
      )
    );
  });

  it("re-uses the cached pty id on remount", async () => {
    registerStubProvider();
    const ws = makeWorkspace({ id: "ws-2", worktreePath: "/p/wt" });
    useWorkbench.setState({
      ...initial,
      workspaces: [ws],
      activeWorkspaceId: "ws-2",
    });
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-2" } as never);

    const { unmount } = renderWithProviders(<BottomTerminal />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    unmount();

    renderWithProviders(<BottomTerminal />);
    await waitFor(() => expect(screen.getByTestId("bottom-terminal")).toBeInTheDocument());
    // No additional spawn invoked the second time
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("ignores a late spawn result after unmount", async () => {
    let resolveSpawn!: (v: { ptyId: string }) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise<{ ptyId: string }>((res) => { resolveSpawn = res; }) as never
    );
    const ws = makeWorkspace({ id: "ws-late", worktreePath: "/p/wt" });
    useWorkbench.setState({ ...initial, workspaces: [ws], activeWorkspaceId: "ws-late" });

    const { unmount } = renderWithProviders(<BottomTerminal />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    unmount();
    resolveSpawn({ ptyId: "late-pty" });
    await Promise.resolve();
    expect(__testing__.ptyCache.has("ws-late")).toBe(false);
  });

  it("ignores a late spawn error after unmount", async () => {
    let rejectSpawn!: (e: Error) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise<{ ptyId: string }>((_, rej) => { rejectSpawn = rej; }) as never
    );
    const ws = makeWorkspace({ id: "ws-late-err", worktreePath: "/p/wt" });
    useWorkbench.setState({ ...initial, workspaces: [ws], activeWorkspaceId: "ws-late-err" });

    const { unmount } = renderWithProviders(<BottomTerminal />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    unmount();
    rejectSpawn(new Error("late failure"));
    await Promise.resolve();
    expect(__testing__.ptyCache.has("ws-late-err")).toBe(false);
  });

  it("surfaces an error state when pty_spawn rejects", async () => {
    const ws = makeWorkspace({ id: "ws-3", worktreePath: "/p/wt" });
    useWorkbench.setState({
      ...initial,
      workspaces: [ws],
      activeWorkspaceId: "ws-3",
    });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("spawn failed"));

    renderWithProviders(<BottomTerminal />);
    expect(await screen.findByTestId("bottom-terminal-error")).toHaveTextContent("spawn failed");
  });

  it("killBottomPty kills and evicts the cached shell pty", async () => {
    __testing__.ptyCache.set("ws-k", "pty-bottom");
    killBottomPty("ws-k");
    expect(__testing__.ptyCache.has("ws-k")).toBe(false);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("pty_kill", { ptyId: "pty-bottom" }));
  });

  it("killBottomPty is a no-op when nothing is cached", () => {
    killBottomPty("absent");
    expect(invoke).not.toHaveBeenCalledWith("pty_kill", expect.anything());
  });
});
