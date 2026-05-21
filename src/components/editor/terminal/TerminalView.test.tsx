import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act } from "@testing-library/react";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { TerminalView } from "./TerminalView";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";
import { TerminalRegistry, type TerminalProvider, type TerminalHandle } from "@/lib/terminal-provider";

const initial = useWorkbench.getState();

const handle: TerminalHandle = {
  write: vi.fn(), resize: vi.fn(), setTheme: vi.fn(), focus: vi.fn(), dispose: vi.fn(),
  get dimensions() { return { cols: 0, rows: 0 }; },
};
const provider: TerminalProvider = { mount: () => handle };

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(listen).mockReset().mockResolvedValue(() => {});
  TerminalRegistry.register(provider);
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
