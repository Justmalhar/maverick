import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { WorkspaceEditor } from "./WorkspaceEditor";
import { __testing__ as leafTesting } from "./terminal/leaf-registry";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";
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
  const provider: TerminalProvider = { mount: () => handle };
  TerminalRegistry.register(provider);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue({ ptyId: "pty-shell" } as never);
  vi.mocked(listen).mockReset().mockResolvedValue(() => {});
  leafTesting.leafPtyCache.clear();
  registerStubProvider();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  useWorkbench.setState({ ...initial, launchSpecs: {}, splitTrees: {} });
});

describe("WorkspaceEditor", () => {
  it("mounts every group, shows only the active one", () => {
    const ws = { id: "w1", projectId: "p", branch: "b", agentBackend: "claude", worktreePath: "/wt", status: "active" as const, sessionId: "s", mode: "terminal" as const };
    useWorkbench.setState({
      workspaces: [ws],
      terminalGroups: [
        { id: "w1", workspaceId: "w1", title: "Terminal 1" },
        { id: "term-2", workspaceId: "w1", title: "Terminal 2" },
      ],
      activeGroupByWorkspace: { w1: "term-2" },
      splitTrees: {},
    });
    renderWithProviders(<WorkspaceEditor workspace={ws} active />);
    expect(screen.getByTestId("terminal-view-w1")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-view-term-2")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-group-w1").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("terminal-group-term-2").getAttribute("aria-hidden")).toBe("false");
  });

  it("renders only the terminal view and spawns a shell in the worktree", async () => {
    const ws = makeWorkspace({ id: "w1", worktreePath: "/wt" });
    useWorkbench.setState({
      terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
      activeGroupByWorkspace: { w1: "w1" },
    });
    renderWithProviders(<WorkspaceEditor workspace={ws} active />);
    expect(screen.getByTestId("workspace-editor-w1")).toBeInTheDocument();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ cwd: "/wt" })
      )
    );
    expect(await screen.findByTestId("terminal-view-w1")).toBeInTheDocument();
  });

  it("inactive workspace adds the keep-alive-hidden class", () => {
    const ws = makeWorkspace({ id: "w1" });
    useWorkbench.setState({
      terminalGroups: [{ id: "w1", workspaceId: "w1", title: "Terminal 1" }],
      activeGroupByWorkspace: { w1: "w1" },
    });
    renderWithProviders(<WorkspaceEditor workspace={ws} active={false} />);
    expect(screen.getByTestId("workspace-editor-w1").className).toMatch(/keep-alive-hidden/);
  });

  it("renders AgentChatView for the primary group of an agent-mode workspace", () => {
    const ws = makeWorkspace({ id: "wsA", mode: "agent" });
    useWorkbench.setState({
      terminalGroups: [{ id: "wsA", workspaceId: "wsA", title: "Terminal 1" }],
      activeGroupByWorkspace: { wsA: "wsA" },
    });
    renderWithProviders(<WorkspaceEditor workspace={ws} active />);
    expect(screen.getByTestId("agent-chat-wsA")).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-view-wsA")).not.toBeInTheDocument();
  });

  it("still renders TerminalView for extra groups of an agent-mode workspace", () => {
    const ws = makeWorkspace({ id: "wsA", mode: "agent" });
    useWorkbench.setState({
      terminalGroups: [
        { id: "wsA", workspaceId: "wsA", title: "Terminal 1" },
        { id: "g2", workspaceId: "wsA", title: "Terminal 2" },
      ],
      activeGroupByWorkspace: { wsA: "wsA" },
    });
    renderWithProviders(<WorkspaceEditor workspace={ws} active />);
    expect(screen.getByTestId("terminal-group-g2")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-view-g2")).toBeInTheDocument();
  });
});
