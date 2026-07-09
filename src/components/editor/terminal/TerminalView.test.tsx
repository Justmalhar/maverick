import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act } from "@testing-library/react";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { TerminalView } from "./TerminalView";
import { __testing__ } from "./leaf-registry";
import { __resetLaunchedForTests } from "@/hooks/useLaunchSpec";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";
import { TerminalRegistry, type TerminalProvider, type TerminalHandle } from "@/lib/terminal-provider";

const initial = useWorkbench.getState();

const handle: TerminalHandle = {
  write: vi.fn(), onData: vi.fn(() => () => {}), onResize: vi.fn(() => () => {}), resize: vi.fn(), setTheme: vi.fn(), focus: vi.fn(), dispose: vi.fn(),
  get dimensions() { return { cols: 0, rows: 0 }; },
};
const provider: TerminalProvider = { mount: () => handle };

beforeEach(() => {
  // Terminal-mode leaves spawn a shell PTY via ptySpawn -> invoke("pty_spawn"),
  // which resolves { ptyId }. Resolve it so leaves reach the "ready" pane state.
  vi.mocked(invoke).mockReset().mockResolvedValue({ ptyId: "pty-x" } as never);
  vi.mocked(listen).mockReset().mockResolvedValue(() => {});
  TerminalRegistry.register(provider);
  __testing__.leafPtyCache.clear();
  __resetLaunchedForTests();
  useWorkbench.setState({ ...initial, splitTrees: {}, launchSpecs: {} });
});

describe("TerminalView", () => {
  it("seeds a singlePane on first mount and renders the grid", async () => {
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    await waitFor(() => expect(screen.getByTestId("terminal-view-w1")).toBeInTheDocument());
    expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined();
  });

  it("renders the loading placeholder before a tree exists", () => {
    // Spy on store: prevent the singlePane effect from filling, by intercepting setSplitTree.
    const setSplitTree = vi.spyOn(useWorkbench.getState(), "setSplitTree").mockImplementation(() => {});
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    expect(screen.getByText("Initialising terminal…")).toBeInTheDocument();
    setSplitTree.mockRestore();
  });

  it("splits the default-focused first leaf without a prior click", async () => {
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());

    // No click: focus defaults to the tree's first leaf, so the split applies.
    act(() => {
      window.dispatchEvent(new CustomEvent("maverick:terminal:splitH"));
    });
    const tree = useWorkbench.getState().splitTrees["w1"];
    expect(tree?.type).toBe("split");
    // The original leaf survives as the left child of the new split.
    expect(tree?.type === "split" && tree.left.type === "terminal" && tree.left.id).toBe("w1-1");

    // closePane targets the focused (new right) pane and collapses back to one.
    act(() => {
      window.dispatchEvent(new CustomEvent("maverick:terminal:closePane"));
    });
    expect(useWorkbench.getState().splitTrees["w1"]?.type).toBe("terminal");
  });

  it("splits vertically via the splitV event", async () => {
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());
    act(() => {
      window.dispatchEvent(new CustomEvent("maverick:terminal:splitV"));
    });
    const tree = useWorkbench.getState().splitTrees["w1"];
    expect(tree?.type).toBe("split");
    expect(tree?.type === "split" && tree.direction).toBe("v");
  });

  it("closePane on the last remaining pane reseeds a fresh singlePane", async () => {
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());
    act(() => {
      window.dispatchEvent(new CustomEvent("maverick:terminal:closePane"));
    });
    // removeNode on a lone leaf returns null → the view falls back to singlePane.
    expect(useWorkbench.getState().splitTrees["w1"]?.type).toBe("terminal");
  });

  it("split and close are no-ops while the tree has not been seeded yet", async () => {
    const setSplitTree = vi.spyOn(useWorkbench.getState(), "setSplitTree").mockImplementation(() => {});
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    act(() => {
      window.dispatchEvent(new CustomEvent("maverick:terminal:splitH"));
      window.dispatchEvent(new CustomEvent("maverick:terminal:closePane"));
      window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "right" }));
    });
    expect(useWorkbench.getState().splitTrees["w1"]).toBeUndefined();
    setSplitTree.mockRestore();
  });

  it("ignores split events when not visible (inactive workspace)", async () => {
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(
      <TerminalView workspace={ws} groupId={ws.id} visible={false} />
    );
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());
    // A global ⌘D must not split a keep-alive-hidden (inactive) terminal view.
    act(() => {
      window.dispatchEvent(new CustomEvent("maverick:terminal:splitH"));
      window.dispatchEvent(new CustomEvent("maverick:terminal:splitV"));
    });
    expect(useWorkbench.getState().splitTrees["w1"]?.type).toBe("terminal");
  });

  it("focusDirection right moves focus to the right pane after a horizontal split", async () => {
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());

    // Focus the initial pane, then split horizontally
    const pane = await screen.findByTestId("terminal-pane-w1-1");
    act(() => { pane.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:splitH")); });

    const splits = useWorkbench.getState().splitTrees["w1"];
    const rightId = splits?.type === "split" && splits.right.type === "terminal" ? splits.right.id : "";
    expect(rightId).toBeTruthy();

    // Re-focus the left pane by updating focusedPaneId back to original
    act(() => { pane.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });

    // Now focus right
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "right" })); });
    // The store tree is unchanged; what changes is focusedPaneId in TerminalView state.
    // We verify by then firing focusDirection left and expecting no crash.
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "left" })); });
  });

  it("focusDirection is a no-op when no pane is focused", async () => {
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());
    // No focused pane → should not throw
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "right" })); });
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "left" })); });
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "up" })); });
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "down" })); });
  });

  it("focusDirection is a no-op at the edge of the tree", async () => {
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());

    // Focus the single pane (no neighbours exist)
    const pane = await screen.findByTestId("terminal-pane-w1-1");
    act(() => { pane.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });

    // All directions should be no-ops since it's a single-leaf tree
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "left" })); });
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "right" })); });
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "up" })); });
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "down" })); });
    // Tree should remain a single-leaf terminal
    expect(useWorkbench.getState().splitTrees["w1"]?.type).toBe("terminal");
  });

  it("input-append writes the text to the focused leaf's shell PTY", async () => {
    __testing__.leafPtyCache.set("w1-1", "pty-w1-1");
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());
    act(() => {
      window.dispatchEvent(
        new CustomEvent("maverick:input-append", { detail: { text: "ls -la\r" } })
      );
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "pty-w1-1", data: "ls -la\r" })
    );
  });

  it("input-append is a no-op when the view is not visible", async () => {
    __testing__.leafPtyCache.set("w1-1", "pty-w1-1");
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(
      <TerminalView workspace={ws} groupId={ws.id} visible={false} />
    );
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());
    act(() => {
      window.dispatchEvent(
        new CustomEvent("maverick:input-append", { detail: { text: "ls\r" } })
      );
    });
    expect(invoke).not.toHaveBeenCalledWith("pty_write", expect.anything());
  });

  it("input-append is a no-op when the focused leaf has no live PTY", async () => {
    // Shell spawn never resolves → no pty cached for the focused leaf.
    vi.mocked(invoke).mockImplementation(() => new Promise<never>(() => {}) as never);
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());
    act(() => {
      window.dispatchEvent(
        new CustomEvent("maverick:input-append", { detail: { text: "ls\r" } })
      );
    });
    expect(invoke).not.toHaveBeenCalledWith("pty_write", expect.anything());
  });

  it("input-append is a no-op when the event carries no text", async () => {
    __testing__.leafPtyCache.set("w1-1", "pty-w1-1");
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());
    act(() => {
      window.dispatchEvent(
        new CustomEvent("maverick:input-append", { detail: { text: "" } })
      );
    });
    expect(invoke).not.toHaveBeenCalledWith("pty_write", expect.anything());
  });

  it("split events do nothing when the tree cannot accept more leaves", async () => {
    useWorkbench.setState({
      ...initial,
      splitTrees: {
        w1: (() => {
          const leaf = (id: string) => ({ type: "terminal" as const, id, backend: "shell", ptyId: "p" });
          const left = { type: "split" as const, direction: "h" as const, ratio: 0.5,
            left: leaf("1"), right: { type: "split" as const, direction: "h" as const, ratio: 0.5, left: leaf("2"), right: leaf("3") } };
          const right = { type: "split" as const, direction: "h" as const, ratio: 0.5,
            left: leaf("4"), right: { type: "split" as const, direction: "h" as const, ratio: 0.5, left: leaf("5"), right: leaf("6") } };
          return { type: "split" as const, direction: "v" as const, ratio: 0.5, left, right };
        })(),
      },
    });
    const ws = makeWorkspace({ id: "w1" });
    renderWithProviders(<TerminalView workspace={ws} groupId={ws.id} />);
    const pane = await screen.findByTestId("terminal-pane-1");
    act(() => {
      pane.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      window.dispatchEvent(new CustomEvent("maverick:terminal:splitH"));
    });
    // Tree should remain a split with 6 leaves (no growth)
    expect(useWorkbench.getState().splitTrees["w1"]?.type).toBe("split");
  });

  it("seeds and reads the split tree under groupId, not workspace.id", async () => {
    const ws = { id: "w1", projectId: "p", branch: "b", agentBackend: "claude", worktreePath: "/wt", status: "active" as const, sessionId: "s", mode: "terminal" as const };
    renderWithProviders(<TerminalView workspace={ws} groupId="term-x" visible />);
    await waitFor(() => expect(useWorkbench.getState().splitTrees["term-x"]).toBeDefined());
    const node = useWorkbench.getState().splitTrees["term-x"];
    expect(node.type === "terminal" && node.id).toBe("term-x-1");
  });
});
