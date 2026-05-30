import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { SplitGrid } from "./SplitGrid";
import { TerminalRegistry, type TerminalProvider, type TerminalHandle } from "@/lib/terminal-provider";

const handle: TerminalHandle = {
  write: vi.fn(), onData: vi.fn(() => () => {}), onResize: vi.fn(() => () => {}), resize: vi.fn(), setTheme: vi.fn(), focus: vi.fn(), dispose: vi.fn(),
  get dimensions() { return { cols: 0, rows: 0 }; },
};
const provider: TerminalProvider = { mount: () => handle };
TerminalRegistry.register(provider);

describe("SplitGrid", () => {
  it("renders a single terminal leaf", () => {
    renderWithProviders(
      <SplitGrid
        tree={{ type: "terminal", id: "p1", backend: "shell", ptyId: "x" }}
        focusedPaneId="p1"
        onFocus={() => {}}
      />
    );
    expect(screen.getByTestId("terminal-pane-p1")).toBeInTheDocument();
  });

  it("recurses into horizontal and vertical splits", () => {
    renderWithProviders(
      <SplitGrid
        tree={{
          type: "split", direction: "h", ratio: 0.5,
          left: { type: "terminal", id: "a", backend: "shell", ptyId: "x" },
          right: {
            type: "split", direction: "v", ratio: 0.5,
            left: { type: "terminal", id: "b", backend: "shell", ptyId: "y" },
            right: { type: "terminal", id: "c", backend: "shell", ptyId: "z" },
          },
        }}
        focusedPaneId="b"
        onFocus={() => {}}
      />
    );
    expect(screen.getByTestId("terminal-pane-a")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-pane-b")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-pane-c")).toBeInTheDocument();
  });
});
