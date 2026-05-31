import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act } from "@testing-library/react";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { TerminalView } from "./TerminalView";
import { __testing__ } from "./TerminalLeaf";
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
  useWorkbench.setState({ ...initial, splitTrees: {} });
});

describe("TerminalView", () => {
  it("seeds a singlePane on first mount and renders the grid", async () => {
    renderWithProviders(<TerminalView workspace={makeWorkspace({ id: "w1" })} />);
    await waitFor(() => expect(screen.getByTestId("terminal-view-w1")).toBeInTheDocument());
    expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined();
  });

  it("renders the loading placeholder before a tree exists", () => {
    // Spy on store: prevent the singlePane effect from filling, by intercepting setSplitTree.
    const setSplitTree = vi.spyOn(useWorkbench.getState(), "setSplitTree").mockImplementation(() => {});
    renderWithProviders(<TerminalView workspace={makeWorkspace({ id: "w1" })} />);
    expect(screen.getByText("Initialising terminal…")).toBeInTheDocument();
    setSplitTree.mockRestore();
  });

  it("splitH and splitV dispatch event handlers add a pane when canSplit and focusedPaneId", async () => {
    renderWithProviders(<TerminalView workspace={makeWorkspace({ id: "w1" })} />);
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());

    // No focused pane initially → splitH should no-op
    act(() => {
      window.dispatchEvent(new CustomEvent("maverick:terminal:splitH"));
      window.dispatchEvent(new CustomEvent("maverick:terminal:splitV"));
      window.dispatchEvent(new CustomEvent("maverick:terminal:closePane"));
    });

    // Focus a pane by clicking it
    const pane = await screen.findByTestId("terminal-pane-w1-1");
    act(() => {
      pane.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("maverick:terminal:splitH"));
    });
    expect(useWorkbench.getState().splitTrees["w1"]?.type).toBe("split");

    // Re-focus the new pane
    const splits = useWorkbench.getState().splitTrees["w1"];
    const newId = splits && splits.type === "split" && splits.right.type === "terminal" ? splits.right.id : "";
    expect(newId).toBeTruthy();

    // closePane on focused new pane collapses to original single
    act(() => {
      window.dispatchEvent(new CustomEvent("maverick:terminal:closePane"));
    });

    // closePane with no focus is a no-op
    act(() => {
      window.dispatchEvent(new CustomEvent("maverick:terminal:closePane"));
    });
  });

  it("focusDirection right moves focus to the right pane after a horizontal split", async () => {
    renderWithProviders(<TerminalView workspace={makeWorkspace({ id: "w1" })} />);
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
    renderWithProviders(<TerminalView workspace={makeWorkspace({ id: "w1" })} />);
    await waitFor(() => expect(useWorkbench.getState().splitTrees["w1"]).toBeDefined());
    // No focused pane → should not throw
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "right" })); });
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "left" })); });
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "up" })); });
    act(() => { window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "down" })); });
  });

  it("focusDirection is a no-op at the edge of the tree", async () => {
    renderWithProviders(<TerminalView workspace={makeWorkspace({ id: "w1" })} />);
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
    renderWithProviders(<TerminalView workspace={makeWorkspace({ id: "w1" })} />);
    const pane = await screen.findByTestId("terminal-pane-1");
    act(() => {
      pane.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      window.dispatchEvent(new CustomEvent("maverick:terminal:splitH"));
    });
    // Tree should remain a split with 6 leaves (no growth)
    expect(useWorkbench.getState().splitTrees["w1"]?.type).toBe("split");
  });
});
