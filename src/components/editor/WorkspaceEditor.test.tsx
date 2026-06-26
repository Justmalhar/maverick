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
  it("renders only the terminal view and spawns a shell in the worktree", async () => {
    renderWithProviders(<WorkspaceEditor workspace={makeWorkspace({ id: "w1", worktreePath: "/wt" })} active />);
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
    renderWithProviders(<WorkspaceEditor workspace={makeWorkspace({ id: "w1" })} active={false} />);
    expect(screen.getByTestId("workspace-editor-w1").className).toMatch(/keep-alive-hidden/);
  });
});
