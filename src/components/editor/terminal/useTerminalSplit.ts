import { useEffect, useState } from "react";
import { useWorkbench } from "@/state/store";
import type { SplitLeaf, SplitNode } from "@/lib/ipc";
import {
  splitNode,
  removeNode,
  canSplit,
  findNeighbor,
  firstLeafId,
  type FocusDirection,
} from "@/lib/splitnode";
import { killLeaf } from "./TerminalLeaf";

interface Options {
  // Key into the store's splitTrees map. Terminal mode uses the workspace id;
  // agent mode uses `agent:<id>` so toggling modes never clobbers the other tree.
  storeKey: string;
  // Split/close/focus events are global (one ⌘D dispatch). Only the active view
  // reacts — otherwise a single shortcut would split every keep-alive-mounted
  // workspace at once.
  active: boolean;
  makeRoot: () => SplitNode;
  makeLeaf: () => SplitLeaf;
  // A leaf that must never be closed (e.g. the agent CLI pane).
  protectedLeafId?: string;
}

/**
 * Owns a workspace's split tree + focused-pane state and wires the global
 * terminal split/close/focus keyboard events to it. Shared by TerminalView
 * (shell panes) and AgentSplitView (agent pane + shell panes).
 */
export function useTerminalSplit({
  storeKey,
  active,
  makeRoot,
  makeLeaf,
  protectedLeafId,
}: Options): {
  tree: SplitNode | undefined;
  focusedPaneId: string | null;
  setFocusedPaneId: (id: string) => void;
} {
  const tree = useWorkbench((s) => s.splitTrees[storeKey]);
  const setSplitTree = useWorkbench((s) => s.setSplitTree);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);

  useEffect(() => {
    if (!tree) setSplitTree(storeKey, makeRoot());
    // Seed once when absent; makeRoot is intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, storeKey, setSplitTree]);

  // Default focus to the first leaf so split/close act on a sane target before
  // the user has clicked a pane.
  useEffect(() => {
    if (tree && !focusedPaneId) setFocusedPaneId(firstLeafId(tree));
  }, [tree, focusedPaneId]);

  useEffect(() => {
    if (!active) return;
    function onSplit(direction: "h" | "v") {
      const current = useWorkbench.getState().splitTrees[storeKey];
      if (!current || !focusedPaneId) return;
      if (!canSplit(current)) return;
      const leaf = makeLeaf();
      setSplitTree(storeKey, splitNode(current, focusedPaneId, direction, leaf));
      setFocusedPaneId(leaf.id);
    }
    function onClose() {
      const current = useWorkbench.getState().splitTrees[storeKey];
      if (!current || !focusedPaneId) return;
      if (focusedPaneId === protectedLeafId) return;
      killLeaf(focusedPaneId);
      const next = removeNode(current, focusedPaneId) ?? makeRoot();
      setSplitTree(storeKey, next);
      setFocusedPaneId(firstLeafId(next));
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
    // makeRoot/makeLeaf are stable (useCallback) per caller; excluded to avoid
    // re-subscribing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focusedPaneId, storeKey, setSplitTree, protectedLeafId]);

  useEffect(() => {
    if (!active) return;
    function onFocusDirection(e: Event) {
      const direction = (e as CustomEvent<FocusDirection>).detail;
      const current = useWorkbench.getState().splitTrees[storeKey];
      if (!current || !focusedPaneId) return;
      const neighbour = findNeighbor(current, focusedPaneId, direction);
      if (neighbour) setFocusedPaneId(neighbour);
    }
    window.addEventListener("maverick:terminal:focusDirection", onFocusDirection);
    return () => {
      window.removeEventListener("maverick:terminal:focusDirection", onFocusDirection);
    };
  }, [active, focusedPaneId, storeKey]);

  return { tree, focusedPaneId, setFocusedPaneId };
}
