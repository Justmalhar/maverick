import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  usePresets,
  splitTreeToPresetNode,
  presetNodeToSplitTree,
  buildWorkspaceLayout,
} from "./usePresets";
import { useWorkbench } from "@/state/store";
import { makePreset, makeWorkspace } from "@/test/fixtures";
import type { PresetNode, SplitNode } from "@/lib/ipc";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, workspaces: [], splitTrees: {} });
});

describe("usePresets", () => {
  it("loads presets on mount", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makePreset({ name: "p1" })] as never);
    const { result } = renderHook(() => usePresets("/p"));
    await waitFor(() => expect(result.current.presets).toHaveLength(1));
  });

  it("swallows load errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("nope"));
    const { result } = renderHook(() => usePresets("/p"));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(result.current.presets).toEqual([]);
  });

  it("launch and saveCurrentLayout invoke + update state", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never);
    useWorkbench.setState({
      workspaces: [makeWorkspace({ id: "w1", agentBackend: "codex" })],
    });
    const { result } = renderHook(() => usePresets());
    await waitFor(() => expect(invoke).toHaveBeenCalled());

    vi.mocked(invoke).mockResolvedValueOnce({ workspaceId: "wX" } as never);
    let res: { workspaceId: string } | undefined;
    await act(async () => {
      res = await result.current.launch(makePreset(), "p1", "main");
    });
    expect(res).toEqual({ workspaceId: "wX" });

    vi.mocked(invoke).mockResolvedValueOnce(makePreset({ name: "saved" }) as never);
    await act(async () => {
      await result.current.saveCurrentLayout("w1", "saved");
    });
    expect(result.current.presets.find((p) => p.name === "saved")).toBeDefined();
    // The save invoke carries the layout derived from the workspace.
    expect(invoke).toHaveBeenLastCalledWith(
      "preset_save_current",
      expect.objectContaining({
        workspaceId: "w1",
        name: "saved",
        layout: { type: "terminal", agent: "codex", cwd: "{{workspace_root}}", mode: "terminal" },
      })
    );
  });
});

describe("splitTreeToPresetNode", () => {
  it("maps a terminal leaf to a terminal preset node", () => {
    const leaf: SplitNode = { type: "terminal", id: "1", backend: "claude", ptyId: "" };
    expect(splitTreeToPresetNode(leaf, "agent")).toEqual({
      type: "terminal",
      agent: "claude",
      cwd: "{{workspace_root}}",
      mode: "agent",
    });
  });

  it("maps a vertical split to a top/bottom preset split", () => {
    const tree: SplitNode = {
      type: "split",
      direction: "v",
      ratio: 0.4,
      left: { type: "terminal", id: "1", backend: "a", ptyId: "" },
      right: { type: "terminal", id: "2", backend: "b", ptyId: "" },
    };
    const node = splitTreeToPresetNode(tree, "terminal");
    expect(node).toMatchObject({ type: "split", direction: "v", ratio: 0.4 });
    if (node.type === "split" && "top" in node) {
      expect(node.top).toMatchObject({ agent: "a", mode: "terminal" });
      expect(node.bottom).toMatchObject({ agent: "b" });
    } else {
      throw new Error("expected a top/bottom split");
    }
  });

  it("maps a horizontal split to a left/right preset split", () => {
    const tree: SplitNode = {
      type: "split",
      direction: "h",
      ratio: 0.6,
      left: { type: "terminal", id: "1", backend: "a", ptyId: "" },
      right: { type: "terminal", id: "2", backend: "b", ptyId: "" },
    };
    const node = splitTreeToPresetNode(tree, "agent");
    expect(node).toMatchObject({ type: "split", direction: "h", ratio: 0.6 });
    if (node.type === "split" && "left" in node) {
      expect(node.left).toMatchObject({ agent: "a" });
      expect(node.right).toMatchObject({ agent: "b" });
    } else {
      throw new Error("expected a left/right split");
    }
  });
});

describe("presetNodeToSplitTree", () => {
  const term = (agent: string, over: Partial<PresetNode> = {}): PresetNode =>
    ({ type: "terminal", agent, cwd: "{{workspace_root}}", mode: "terminal", ...over }) as PresetNode;

  it("maps a terminal node to a primary leaf that spawns its resolved command (#3)", () => {
    const tree = presetNodeToSplitTree(term("claude-code", { cwd: "/wt", startup: "hi" }), "ws");
    expect(tree).toMatchObject({
      type: "terminal",
      id: "ws-1", // 1-based, primary first — keeps killWorkspaceLeaves matching
      backend: "claude-code",
      command: "claude", // resolved via BACKEND_COMMAND_FALLBACK
      cwd: "/wt",
      startup: "hi",
    });
  });

  it("a shell/empty agent leaf carries NO command (spawns the default shell)", () => {
    const tree = presetNodeToSplitTree(term("shell"), "ws");
    expect(tree.type === "terminal" && tree.command).toBeUndefined();
    // {{workspace_root}} cwd is dropped — TerminalLeaf defaults cwd to the worktree.
    expect(tree.type === "terminal" && tree.cwd).toBeUndefined();
  });

  it("sequences leaf ids 1-based across a split (primary first)", () => {
    const layout: PresetNode = {
      type: "split", direction: "v", ratio: 0.5, top: term("claude-code"), bottom: term("shell"),
    };
    const tree = presetNodeToSplitTree(layout, "ws");
    expect(tree.type).toBe("split");
    if (tree.type === "split") {
      expect((tree.left as { id: string }).id).toBe("ws-1");
      expect((tree.right as { id: string }).id).toBe("ws-2");
    }
  });

  it("collapses a split whose other side is a browser node to the terminal sibling", () => {
    const layout: PresetNode = {
      type: "split", direction: "h", ratio: 0.5, left: term("claude-code"), right: { type: "browser", url: "x" },
    };
    const tree = presetNodeToSplitTree(layout, "ws");
    expect(tree).toMatchObject({ type: "terminal", id: "ws-1" });
  });

  it("falls back to a single shell leaf when the layout is a bare browser node", () => {
    const tree = presetNodeToSplitTree({ type: "browser" }, "ws");
    expect(tree).toEqual({ type: "terminal", id: "ws-1", backend: "shell", ptyId: "" });
  });
});

describe("buildWorkspaceLayout", () => {
  it("uses the split tree when present", () => {
    useWorkbench.setState({
      workspaces: [makeWorkspace({ id: "ws", agentBackend: "claude" })],
      splitTrees: { ws: { type: "terminal", id: "1", backend: "shell", ptyId: "" } },
    });
    expect(buildWorkspaceLayout("ws")).toEqual({
      type: "terminal",
      agent: "shell",
      cwd: "{{workspace_root}}",
      mode: "terminal",
    });
  });

  it("falls back to a single terminal-mode node when no tree exists", () => {
    useWorkbench.setState({
      workspaces: [makeWorkspace({ id: "ws", agentBackend: "gemini" })],
    });
    expect(buildWorkspaceLayout("ws")).toEqual({
      type: "terminal",
      agent: "gemini",
      cwd: "{{workspace_root}}",
      mode: "terminal",
    });
  });

  it("defaults the agent to shell when the workspace is unknown", () => {
    expect(buildWorkspaceLayout("missing")).toEqual({
      type: "terminal",
      agent: "shell",
      cwd: "{{workspace_root}}",
      mode: "terminal",
    });
  });
});
