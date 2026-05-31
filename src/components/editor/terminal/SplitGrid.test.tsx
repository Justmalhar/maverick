import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen } from "@/test/utils";
import { SplitGrid } from "./SplitGrid";
import { __testing__ } from "./TerminalLeaf";
import { makeWorkspace } from "@/test/fixtures";
import { TerminalRegistry, type TerminalProvider, type TerminalHandle } from "@/lib/terminal-provider";

const handle: TerminalHandle = {
  write: vi.fn(), onData: vi.fn(() => () => {}), onResize: vi.fn(() => () => {}), resize: vi.fn(), setTheme: vi.fn(), focus: vi.fn(), dispose: vi.fn(),
  get dimensions() { return { cols: 0, rows: 0 }; },
};
const provider: TerminalProvider = { mount: () => handle };

const ws = makeWorkspace({ id: "w1", worktreePath: "/wt" });

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue({ ptyId: "pty-x" } as never);
  vi.mocked(listen).mockReset().mockResolvedValue(() => {});
  TerminalRegistry.register(provider);
  __testing__.leafPtyCache.clear();
});

describe("SplitGrid", () => {
  it("renders a single terminal leaf", async () => {
    renderWithProviders(
      <SplitGrid
        tree={{ type: "terminal", id: "p1", backend: "shell", ptyId: "x" }}
        workspace={ws}
        focusedPaneId="p1"
        onFocus={() => {}}
      />
    );
    expect(await screen.findByTestId("terminal-pane-p1")).toBeInTheDocument();
  });

  it("recurses into horizontal and vertical splits", async () => {
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
        workspace={ws}
        focusedPaneId="b"
        onFocus={() => {}}
      />
    );
    expect(await screen.findByTestId("terminal-pane-a")).toBeInTheDocument();
    expect(await screen.findByTestId("terminal-pane-b")).toBeInTheDocument();
    expect(await screen.findByTestId("terminal-pane-c")).toBeInTheDocument();
  });
});
