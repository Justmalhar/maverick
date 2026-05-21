import type { SplitNode } from "./ipc";

export function countLeaves(node: SplitNode): number {
  if (node.type === "terminal") return 1;
  return countLeaves(node.left) + countLeaves(node.right);
}

export function canSplit(tree: SplitNode): boolean {
  return countLeaves(tree) < 6;
}

export function findNode(
  tree: SplitNode,
  id: string
): SplitNode | null {
  if (tree.type === "terminal") return tree.id === id ? tree : null;
  return findNode(tree.left, id) ?? findNode(tree.right, id);
}

export function removeNode(tree: SplitNode, id: string): SplitNode | null {
  if (tree.type === "terminal") return tree.id === id ? null : tree;
  const left = removeNode(tree.left, id);
  const right = removeNode(tree.right, id);
  if (left === null) return right;
  if (right === null) return left;
  return { ...tree, left, right };
}

export function splitNode(
  tree: SplitNode,
  targetId: string,
  direction: "h" | "v",
  newNode: SplitNode
): SplitNode {
  if (tree.type === "terminal") {
    if (tree.id !== targetId) return tree;
    return { type: "split", direction, ratio: 0.5, left: tree, right: newNode };
  }
  return {
    ...tree,
    left: splitNode(tree.left, targetId, direction, newNode),
    right: splitNode(tree.right, targetId, direction, newNode),
  };
}

export function defaultSixPaneLayout(): SplitNode {
  const t = (id: string): SplitNode => ({
    type: "terminal",
    id,
    backend: "shell",
    ptyId: "",
  });
  return {
    type: "split",
    direction: "v",
    ratio: 0.5,
    left: {
      type: "split",
      direction: "h",
      ratio: 0.33,
      left: t("1"),
      right: {
        type: "split",
        direction: "h",
        ratio: 0.5,
        left: t("2"),
        right: t("3"),
      },
    },
    right: {
      type: "split",
      direction: "h",
      ratio: 0.33,
      left: t("4"),
      right: {
        type: "split",
        direction: "h",
        ratio: 0.5,
        left: t("5"),
        right: t("6"),
      },
    },
  };
}
