import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, waitFor, fireEvent } from "@/test/utils";
import { AgentTerminal, __testing__ } from "./AgentTerminal";
import { useWorkbench } from "@/state/store";
import { makeWorkspace, makeBackend } from "@/test/fixtures";
import { TerminalRegistry, type TerminalHandle, type TerminalProvider } from "@/lib/terminal-provider";

const initial = useWorkbench.getState();

function registerStubProvider() {
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
  TerminalRegistry.register({ mount: () => handle } as TerminalProvider);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue({ ptyId: "pty-x" } as never);
  vi.mocked(listen).mockReset().mockResolvedValue(() => {});
  __testing__.agentPtyCache.clear();
  registerStubProvider();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  useWorkbench.setState({ ...initial, backends: [] });
});

describe("AgentTerminal", () => {
  it("spawns the resolved backend command in the worktree", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude-code", command: "/usr/local/bin/claude", args: [] })],
    });
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-1" } as never);
    renderWithProviders(
      <AgentTerminal workspace={makeWorkspace({ id: "w1", agentBackend: "claude-code", worktreePath: "/wt" })} />
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ command: "/usr/local/bin/claude", cwd: "/wt" })
      )
    );
    expect(await screen.findByTestId("agent-terminal-w1")).toBeInTheDocument();
  });

  it("falls back to the known command when the backend is not in the store", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-2" } as never);
    renderWithProviders(
      <AgentTerminal workspace={makeWorkspace({ id: "w2", agentBackend: "claude-code", worktreePath: "/wt" })} />
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ command: "claude" })
      )
    );
  });

  it("re-uses the cached pty on remount (process survives tab switches)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-3" } as never);
    const ws = makeWorkspace({ id: "w3", agentBackend: "claude-code", worktreePath: "/wt" });
    const { unmount } = renderWithProviders(<AgentTerminal workspace={ws} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    unmount();
    renderWithProviders(<AgentTerminal workspace={ws} />);
    await waitFor(() => expect(screen.getByTestId("agent-terminal-w3")).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error when the backend fails to start", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("command not found"));
    renderWithProviders(
      <AgentTerminal workspace={makeWorkspace({ id: "w4", agentBackend: "claude-code", worktreePath: "/wt" })} />
    );
    expect(await screen.findByTestId("agent-terminal-error-w4")).toHaveTextContent("command not found");
  });

  it("renders the pane and exercises its focus handler", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-f" } as never);
    renderWithProviders(
      <AgentTerminal workspace={makeWorkspace({ id: "w5", agentBackend: "claude-code", worktreePath: "/wt" })} />
    );
    await screen.findByTestId("agent-terminal-w5");
    fireEvent.mouseDown(screen.getByTestId("terminal-pane-agent-w5"));
  });

  it("ignores a late spawn result after unmount", async () => {
    let resolveSpawn!: (v: { ptyId: string }) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise<{ ptyId: string }>((res) => { resolveSpawn = res; }) as never
    );
    const { unmount } = renderWithProviders(
      <AgentTerminal workspace={makeWorkspace({ id: "w6", agentBackend: "claude-code", worktreePath: "/wt" })} />
    );
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    unmount();
    resolveSpawn({ ptyId: "late" });
    await Promise.resolve();
    expect(__testing__.agentPtyCache.has("w6")).toBe(false);
  });

  it("ignores a late spawn error after unmount", async () => {
    let rejectSpawn!: (e: Error) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise<{ ptyId: string }>((_, rej) => { rejectSpawn = rej; }) as never
    );
    const { unmount } = renderWithProviders(
      <AgentTerminal workspace={makeWorkspace({ id: "w7", agentBackend: "claude-code", worktreePath: "/wt" })} />
    );
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    unmount();
    rejectSpawn(new Error("late"));
    await Promise.resolve();
    expect(__testing__.agentPtyCache.has("w7")).toBe(false);
  });
});
