import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, waitFor, fireEvent } from "@/test/utils";
import { AgentTerminal, killAgentPty, __testing__ } from "./AgentTerminal";
import { useWorkbench } from "@/state/store";
import { makeWorkspace, makeBackend } from "@/test/fixtures";
import { TerminalRegistry, type TerminalHandle, type TerminalProvider } from "@/lib/terminal-provider";

const initial = useWorkbench.getState();

// Captured so a test can drive the keystroke (onData) path through the pane.
let dataHandler: ((data: string) => void) | null = null;

function registerStubProvider() {
  dataHandler = null;
  const handle: TerminalHandle = {
    write: vi.fn(),
    onData: vi.fn((cb: (data: string) => void) => {
      dataHandler = cb;
      return () => {};
    }),
    onResize: vi.fn(() => () => {}),
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

// Route invoke by command so the usage recorder's messages_list/context_record
// calls never collide with the pty_spawn assertions.
function routeInvoke(overrides: Record<string, unknown> = {}) {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd in overrides) return Promise.resolve(overrides[cmd]) as never;
    if (cmd === "pty_spawn") return Promise.resolve({ ptyId: "pty-x" }) as never;
    if (cmd === "messages_list") return Promise.resolve([]) as never;
    if (cmd === "context_record" || cmd === "context_usage") {
      return Promise.resolve({
        workspaceId: "w",
        tokensUsed: 0,
        contextWindow: 200000,
        sessionCostEstimate: 0,
      }) as never;
    }
    if (cmd === "message_append") return Promise.resolve({ id: "m1" }) as never;
    return Promise.resolve({}) as never;
  });
}

function spawnCalls(): number {
  return vi.mocked(invoke).mock.calls.filter((c) => c[0] === "pty_spawn").length;
}

beforeEach(() => {
  routeInvoke();
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
    const ws = makeWorkspace({ id: "w3", agentBackend: "claude-code", worktreePath: "/wt" });
    const { unmount } = renderWithProviders(<AgentTerminal workspace={ws} />);
    await waitFor(() => expect(spawnCalls()).toBe(1));
    unmount();
    renderWithProviders(<AgentTerminal workspace={ws} />);
    await waitFor(() => expect(screen.getByTestId("agent-terminal-w3")).toBeInTheDocument());
    expect(spawnCalls()).toBe(1);
  });

  it("surfaces an error when the backend fails to start", async () => {
    routeInvoke();
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "pty_spawn") return Promise.reject(new Error("command not found")) as never;
      if (cmd === "messages_list") return Promise.resolve([]) as never;
      return Promise.resolve({}) as never;
    });
    renderWithProviders(
      <AgentTerminal workspace={makeWorkspace({ id: "w4", agentBackend: "claude-code", worktreePath: "/wt" })} />
    );
    expect(await screen.findByTestId("agent-terminal-error-w4")).toHaveTextContent("command not found");
  });

  it("renders the pane and exercises its focus handler", async () => {
    renderWithProviders(
      <AgentTerminal workspace={makeWorkspace({ id: "w5", agentBackend: "claude-code", worktreePath: "/wt" })} />
    );
    await screen.findByTestId("agent-terminal-w5");
    fireEvent.mouseDown(screen.getByTestId("terminal-pane-agent-w5"));
  });

  it("ignores a late spawn result after unmount", async () => {
    let resolveSpawn!: (v: { ptyId: string }) => void;
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "pty_spawn")
        return new Promise<{ ptyId: string }>((res) => {
          resolveSpawn = res;
        }) as never;
      if (cmd === "messages_list") return Promise.resolve([]) as never;
      return Promise.resolve({}) as never;
    });
    const { unmount } = renderWithProviders(
      <AgentTerminal workspace={makeWorkspace({ id: "w6", agentBackend: "claude-code", worktreePath: "/wt" })} />
    );
    await waitFor(() => expect(spawnCalls()).toBe(1));
    unmount();
    resolveSpawn({ ptyId: "late" });
    await Promise.resolve();
    expect(__testing__.agentPtyCache.has("w6")).toBe(false);
  });

  it("ignores a late spawn error after unmount", async () => {
    let rejectSpawn!: (e: Error) => void;
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "pty_spawn")
        return new Promise<{ ptyId: string }>((_, rej) => {
          rejectSpawn = rej;
        }) as never;
      if (cmd === "messages_list") return Promise.resolve([]) as never;
      return Promise.resolve({}) as never;
    });
    const { unmount } = renderWithProviders(
      <AgentTerminal workspace={makeWorkspace({ id: "w7", agentBackend: "claude-code", worktreePath: "/wt" })} />
    );
    await waitFor(() => expect(spawnCalls()).toBe(1));
    unmount();
    rejectSpawn(new Error("late"));
    await Promise.resolve();
    expect(__testing__.agentPtyCache.has("w7")).toBe(false);
  });

  it("killAgentPty kills and evicts the cached agent pty", async () => {
    __testing__.agentPtyCache.set("wk", "pty-agent");
    killAgentPty("wk");
    expect(__testing__.agentPtyCache.has("wk")).toBe(false);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("pty_kill", { ptyId: "pty-agent" }));
  });

  it("killAgentPty is a no-op when nothing is cached", () => {
    killAgentPty("absent");
    expect(invoke).not.toHaveBeenCalledWith("pty_kill", expect.anything());
  });

  describe("usage recording", () => {
    it("records an estimate from persisted messages on load", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "pty_spawn") return Promise.resolve({ ptyId: "pty-u" }) as never;
        if (cmd === "messages_list")
          return Promise.resolve([
            { id: "m1", sessionId: "sess-1", role: "user", content: "hello", createdAt: 1 },
          ]) as never;
        return Promise.resolve({
          workspaceId: "wU",
          tokensUsed: 2,
          contextWindow: 200000,
          sessionCostEstimate: 0,
        }) as never;
      });
      renderWithProviders(
        <AgentTerminal workspace={makeWorkspace({ id: "wU", sessionId: "sess-1" })} />
      );
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("messages_list", expect.anything()));
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          "context_record",
          expect.objectContaining({ sessionId: "sess-1" })
        )
      );
    });

    it("records a user prompt + usage when the user presses Enter", async () => {
      renderWithProviders(
        <AgentTerminal workspace={makeWorkspace({ id: "wS", sessionId: "sess-2" })} />
      );
      await screen.findByTestId("agent-terminal-wS");
      expect(dataHandler).toBeTypeOf("function");
      // Type a multi-byte prompt, then submit with Enter.
      dataHandler!("fix");
      dataHandler!(" the bug\r");
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("message_append", {
          sessionId: "sess-2",
          role: "user",
          content: "fix the bug",
          toolCallsJson: undefined,
        })
      );
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          "context_record",
          expect.objectContaining({ sessionId: "sess-2" })
        )
      );
    });

    it("ignores an empty submission (Enter on a blank line)", async () => {
      renderWithProviders(
        <AgentTerminal workspace={makeWorkspace({ id: "wE", sessionId: "sess-3" })} />
      );
      await screen.findByTestId("agent-terminal-wE");
      vi.mocked(invoke).mockClear();
      dataHandler!("   \r");
      await Promise.resolve();
      expect(invoke).not.toHaveBeenCalledWith("message_append", expect.anything());
    });

    it("does nothing on input when the workspace has no session", async () => {
      __testing__.agentPtyCache.set("wN", "pty-n");
      renderWithProviders(
        <AgentTerminal workspace={makeWorkspace({ id: "wN", sessionId: "" })} />
      );
      await screen.findByTestId("agent-terminal-wN");
      vi.mocked(invoke).mockClear();
      dataHandler!("anything\r");
      await Promise.resolve();
      expect(invoke).not.toHaveBeenCalledWith("message_append", expect.anything());
    });

    it("falls back to empty history when messages_list rejects", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "pty_spawn") return Promise.resolve({ ptyId: "pty-r" }) as never;
        if (cmd === "messages_list") return Promise.reject(new Error("no session")) as never;
        return Promise.resolve({}) as never;
      });
      renderWithProviders(
        <AgentTerminal workspace={makeWorkspace({ id: "wR", sessionId: "sess-4" })} />
      );
      await screen.findByTestId("agent-terminal-wR");
      // After the failed load, a fresh submit still records against the session.
      dataHandler!("retry\r");
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(
          "message_append",
          expect.objectContaining({ content: "retry" })
        )
      );
    });
  });
});
