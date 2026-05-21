import { useEffect, useState } from "react";
import { useWorkbench } from "@/state/store";
import type { Workspace, SplitNode } from "@/lib/ipc";
import { splitNode, removeNode, canSplit } from "@/lib/splitnode";
import { SplitGrid } from "./SplitGrid";

interface Props {
  workspace: Workspace;
}

function singlePane(workspace: Workspace): SplitNode {
  return {
    type: "terminal",
    id: `${workspace.id}-1`,
    backend: workspace.agentBackend,
    ptyId: workspace.id,
  };
}

export function TerminalView({ workspace }: Props) {
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
        focusedPaneId={focusedPaneId}
        onFocus={setFocusedPaneId}
      />
    </section>
  );
}
