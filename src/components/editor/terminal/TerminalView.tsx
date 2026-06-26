import { useEffect, useState } from "react";
import { useWorkbench } from "@/state/store";
import { ptyWrite } from "@/lib/tauri";
import type { Workspace, SplitNode } from "@/lib/ipc";
import { splitNode, removeNode, canSplit, findNeighbor, firstLeafId, type FocusDirection } from "@/lib/splitnode";
import { SplitGrid } from "./SplitGrid";
import { killLeaf, getLeafPtyId } from "./leaf-registry";

interface Props {
  workspace: Workspace;
  groupId: string;
  // False when the owning workspace editor is keep-alive-hidden. Forwarded to
  // every leaf so dormant panes release their pooled xterm slot.
  visible?: boolean;
}

function singlePane(groupId: string, backend: string): SplitNode {
  return {
    type: "terminal",
    id: `${groupId}-1`,
    backend,
    ptyId: groupId,
  };
}

export function TerminalView({ workspace, groupId, visible = true }: Props) {
  const tree = useWorkbench((s) => s.splitTrees[groupId]);
  const setSplitTree = useWorkbench((s) => s.setSplitTree);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);

  useEffect(() => {
    if (!tree) {
      setSplitTree(groupId, singlePane(groupId, workspace.agentBackend));
    }
  }, [tree, groupId, workspace.agentBackend, setSplitTree]);

  // Default the focused pane to the tree's first leaf so split/close shortcuts
  // act on a sane target before the user has clicked a pane.
  useEffect(() => {
    if (tree && !focusedPaneId) setFocusedPaneId(firstLeafId(tree));
  }, [tree, focusedPaneId]);

  useEffect(() => {
    // Split events are global; only the active (visible) view should react, or
    // a single ⌘D would split every keep-alive-mounted terminal workspace.
    if (!visible) return;
    function onSplit(direction: "h" | "v") {
      const current = useWorkbench.getState().splitTrees[groupId];
      if (!current || !focusedPaneId) return;
      if (!canSplit(current)) return;
      const newId = `${groupId}-${Date.now()}`;
      const next = splitNode(current, focusedPaneId, direction, {
        type: "terminal",
        id: newId,
        backend: workspace.agentBackend,
        ptyId: groupId,
      });
      setSplitTree(groupId, next);
      setFocusedPaneId(newId);
    }
    function onClose() {
      const current = useWorkbench.getState().splitTrees[groupId];
      if (!current || !focusedPaneId) return;
      killLeaf(focusedPaneId);
      const next = removeNode(current, focusedPaneId);
      setSplitTree(groupId, next ?? singlePane(groupId, workspace.agentBackend));
    }
    const splitH = () => onSplit("h");
    const splitV = () => onSplit("v");
    window.addEventListener("maverick:terminal:splitH", splitH);
    window.addEventListener("maverick:terminal:splitV", splitV);
    window.addEventListener("maverick:terminal:closePane", onClose);
    return () => {
      window.removeEventListener("maverick:terminal:splitH", splitH);
      window.removeEventListener("maverick:terminal:splitV", splitV);
      window.removeEventListener("maverick:terminal:closePane", onClose);
    };
  }, [focusedPaneId, groupId, workspace.agentBackend, setSplitTree, visible]);

  useEffect(() => {
    // Send-to-terminal (e.g. BrowserPanel selection) targets the focused leaf's
    // live shell PTY. Only the visible view reacts, mirroring the split handlers.
    if (!visible) return;
    function onInputAppend(e: Event) {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (!text || !focusedPaneId) return;
      const ptyId = getLeafPtyId(focusedPaneId);
      if (!ptyId) return;
      void ptyWrite(ptyId, text).catch(() => {});
    }
    window.addEventListener("maverick:input-append", onInputAppend);
    return () => {
      window.removeEventListener("maverick:input-append", onInputAppend);
    };
  }, [focusedPaneId, visible]);

  useEffect(() => {
    if (!visible) return;
    function onFocusDirection(e: Event) {
      const direction = (e as CustomEvent<FocusDirection>).detail;
      const current = useWorkbench.getState().splitTrees[groupId];
      if (!current || !focusedPaneId) return;
      const neighbour = findNeighbor(current, focusedPaneId, direction);
      if (neighbour) setFocusedPaneId(neighbour);
    }
    window.addEventListener("maverick:terminal:focusDirection", onFocusDirection);
    return () => {
      window.removeEventListener("maverick:terminal:focusDirection", onFocusDirection);
    };
  }, [focusedPaneId, groupId, visible]);

  if (!tree) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Initialising terminal…
      </div>
    );
  }

  return (
    <section
      data-testid={`terminal-view-${groupId}`}
      className="mv-terminal-view h-full w-full bg-background"
    >
      <SplitGrid
        tree={tree}
        workspace={workspace}
        focusedPaneId={focusedPaneId}
        onFocus={setFocusedPaneId}
        visible={visible}
      />
    </section>
  );
}
