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

export type FocusDirection = "left" | "right" | "up" | "down";

// Maps a direction to the split axis that contains a left/right (or top/bottom)
// relationship.  "h" splits divide space left/right; "v" splits divide top/bottom.
const DIRECTION_AXIS: Record<FocusDirection, "h" | "v"> = {
  left: "h",
  right: "h",
  up: "v",
  down: "v",
};

// Whether the target is in the "left" child of its split parent for this
// direction (meaning the neighbor is in the "right" subtree, and vice-versa).
const COMES_FROM_LEFT: Record<FocusDirection, boolean> = {
  left: false, // neighbour is to the left → target is in right subtree
  right: true, // neighbour is to the right → target is in left subtree
  up: false,   // neighbour is above → target is in right (bottom) subtree
  down: true,  // neighbour is below → target is in left (top) subtree
};

/** Return the id of the first (depth-first) leaf in a subtree. */
export function firstLeafId(node: SplitNode): string {
  if (node.type === "terminal") return node.id;
  return firstLeafId(node.left);
}

/** Return the id of the last (depth-first) leaf in a subtree. */
function lastLeafId(node: SplitNode): string {
  if (node.type === "terminal") return node.id;
  return lastLeafId(node.right);
}

/**
 * Find the id of the spatially adjacent pane in the given direction.
 * Returns null when no neighbour exists (e.g. already at the edge).
 *
 * The algorithm performs a single tree traversal, accumulating the
 * "ancestor stack" from root → target.  At the first ancestor whose axis
 * matches and whose child relationship satisfies the direction, it crosses
 * into the sibling subtree and picks its closest leaf.
 */
export function findNeighbor(tree: SplitNode, fromId: string, direction: FocusDirection): string | null {
  const axis = DIRECTION_AXIS[direction];
  const fromLeft = COMES_FROM_LEFT[direction];

  // Collect the path from root to the target node (list of [parent, "left"|"right"]).
  type Step = { node: SplitNode; side: "left" | "right" };
  const path: Step[] = [];

  function collect(node: SplitNode): boolean {
    if (node.type === "terminal") return node.id === fromId;
    if (collect(node.left)) {
      path.unshift({ node, side: "left" });
      return true;
    }
    if (collect(node.right)) {
      path.unshift({ node, side: "right" });
      return true;
    }
    return false;
  }

  if (!collect(tree)) return null; // fromId not in this tree

  // Walk from the innermost ancestor outward to find the first crossing point.
  for (const step of path) {
    const parent = step.node;
    if (parent.type !== "split") continue;
    if (parent.direction !== axis) continue;
    // fromLeft=true means we look for a parent where the target is in "left"
    // subtree (so the neighbour is in "right"), and vice-versa.
    if (step.side === "left" && !fromLeft) continue;
    if (step.side === "right" && fromLeft) continue;

    // Cross into the sibling and pick its spatially nearest leaf.
    const sibling = step.side === "left" ? parent.right : parent.left;
    // "left" and "up" → neighbour is the last leaf of the sibling subtree.
    // "right" and "down" → neighbour is the first leaf.
    return (direction === "left" || direction === "up")
      ? lastLeafId(sibling)
      : firstLeafId(sibling);
  }

  return null; // already at the edge
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
