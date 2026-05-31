import { useEffect, useState } from "react";
import { useWorkbench } from "@/state/store";
import type { Workspace, SplitNode } from "@/lib/ipc";
import { splitNode, removeNode, canSplit, findNeighbor, type FocusDirection } from "@/lib/splitnode";
import { SplitGrid } from "./SplitGrid";
import { killLeaf } from "./TerminalLeaf";

interface Props {
  workspace: Workspace;
  // False when the owning workspace editor is keep-alive-hidden. Forwarded to
  // every leaf so dormant panes release their pooled xterm slot.
  visible?: boolean;
}

function singlePane(workspace: Workspace): SplitNode {
  return {
    type: "terminal",
    id: `${workspace.id}-1`,
    backend: workspace.agentBackend,
    ptyId: workspace.id,
  };
}

export function TerminalView({ workspace, visible = true }: Props) {
  const tree = useWorkbench((s) => s.splitTrees[workspace.id]);
  const setSplitTree = useWorkbench((s) => s.setSplitTree);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);

  useEffect(() => {
    if (!tree) {
      setSplitTree(workspace.id, singlePane(workspace));
    }
  }, [tree, workspace, setSplitTree]);

  useEffect(() => {
    function onSplit(direction: "h" | "v") {
      const current = useWorkbench.getState().splitTrees[workspace.id];
      if (!current || !focusedPaneId) return;
      if (!canSplit(current)) return;
      const newId = `${workspace.id}-${Date.now()}`;
      const next = splitNode(current, focusedPaneId, direction, {
        type: "terminal",
        id: newId,
        backend: workspace.agentBackend,
        ptyId: workspace.id,
      });
      setSplitTree(workspace.id, next);
      setFocusedPaneId(newId);
    }
    function onClose() {
      const current = useWorkbench.getState().splitTrees[workspace.id];
      if (!current || !focusedPaneId) return;
      killLeaf(focusedPaneId);
      const next = removeNode(current, focusedPaneId);
      setSplitTree(workspace.id, next ?? singlePane(workspace));
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
  }, [focusedPaneId, workspace, setSplitTree]);

  useEffect(() => {
    function onFocusDirection(e: Event) {
      const direction = (e as CustomEvent<FocusDirection>).detail;
      const current = useWorkbench.getState().splitTrees[workspace.id];
      if (!current || !focusedPaneId) return;
      const neighbour = findNeighbor(current, focusedPaneId, direction);
      if (neighbour) setFocusedPaneId(neighbour);
    }
    window.addEventListener("maverick:terminal:focusDirection", onFocusDirection);
    return () => {
      window.removeEventListener("maverick:terminal:focusDirection", onFocusDirection);
    };
  }, [focusedPaneId, workspace.id]);

  if (!tree) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Initialising terminal…
      </div>
    );
  }

  return (
    <section
      data-testid={`terminal-view-${workspace.id}`}
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
