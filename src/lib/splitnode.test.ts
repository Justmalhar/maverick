import { describe, it, expect } from "vitest";
import {
  countLeaves, canSplit, findNode, removeNode, splitNode, defaultSixPaneLayout, findNeighbor,
} from "./splitnode";
import type { SplitNode } from "./ipc";

function leaf(id: string): SplitNode {
  return { type: "terminal", id, backend: "shell", ptyId: "" };
}

describe("splitnode", () => {
  it("countLeaves on terminal node returns 1", () => {
    expect(countLeaves(leaf("1"))).toBe(1);
  });

  it("countLeaves sums recursively", () => {
    const t: SplitNode = { type: "split", direction: "h", ratio: 0.5, left: leaf("a"), right: leaf("b") };
    expect(countLeaves(t)).toBe(2);
  });

  it("canSplit is true under 6 and false at 6 or more", () => {
    expect(canSplit(leaf("1"))).toBe(true);
    expect(canSplit(defaultSixPaneLayout())).toBe(false);
  });

  it("findNode returns the matching terminal or null", () => {
    const t: SplitNode = { type: "split", direction: "v", ratio: 0.5, left: leaf("a"), right: leaf("b") };
    expect(findNode(t, "a")?.type).toBe("terminal");
    expect(findNode(t, "missing")).toBeNull();
    expect(findNode(leaf("z"), "z")?.type).toBe("terminal");
    expect(findNode(leaf("z"), "x")).toBeNull();
  });

  it("removeNode prunes leaves and collapses splits", () => {
    const t: SplitNode = { type: "split", direction: "h", ratio: 0.5, left: leaf("a"), right: leaf("b") };
    expect(removeNode(t, "a")?.type).toBe("terminal");
    expect(removeNode(t, "b")?.type).toBe("terminal");
    expect(removeNode(leaf("a"), "a")).toBeNull();
    expect(removeNode(leaf("a"), "x")?.type).toBe("terminal");

    const both: SplitNode = { type: "split", direction: "v", ratio: 0.5, left: leaf("a"), right: leaf("b") };
    const remaining = removeNode(both, "missing");
    expect(remaining?.type).toBe("split");
  });

  it("splitNode replaces only matching terminal with a split", () => {
    const t = leaf("a");
    const result = splitNode(t, "a", "h", leaf("b"));
    expect(result.type).toBe("split");
    expect(splitNode(leaf("a"), "missing", "h", leaf("b")).type).toBe("terminal");
  });

  it("splitNode recurses into splits", () => {
    const tree: SplitNode = { type: "split", direction: "h", ratio: 0.5, left: leaf("a"), right: leaf("b") };
    const next = splitNode(tree, "a", "v", leaf("c"));
    expect(next.type).toBe("split");
  });

  it("defaultSixPaneLayout returns 6 leaves", () => {
    expect(countLeaves(defaultSixPaneLayout())).toBe(6);
  });

  describe("findNeighbor", () => {
    // Two panes side-by-side horizontally: left="a", right="b"
    const hPair: SplitNode = { type: "split", direction: "h", ratio: 0.5, left: leaf("a"), right: leaf("b") };

    it("right neighbour of left pane in horizontal split", () => {
      expect(findNeighbor(hPair, "a", "right")).toBe("b");
    });

    it("left neighbour of right pane in horizontal split", () => {
      expect(findNeighbor(hPair, "b", "left")).toBe("a");
    });

    it("returns null at the left edge of a horizontal split", () => {
      expect(findNeighbor(hPair, "a", "left")).toBeNull();
    });

    it("returns null at the right edge of a horizontal split", () => {
      expect(findNeighbor(hPair, "b", "right")).toBeNull();
    });

    it("up/down return null in a horizontal split (wrong axis)", () => {
      expect(findNeighbor(hPair, "a", "up")).toBeNull();
      expect(findNeighbor(hPair, "a", "down")).toBeNull();
    });

    // Two panes stacked vertically: top="a" (left), bottom="b" (right)
    const vPair: SplitNode = { type: "split", direction: "v", ratio: 0.5, left: leaf("a"), right: leaf("b") };

    it("down neighbour of top pane in vertical split", () => {
      expect(findNeighbor(vPair, "a", "down")).toBe("b");
    });

    it("up neighbour of bottom pane in vertical split", () => {
      expect(findNeighbor(vPair, "b", "up")).toBe("a");
    });

    it("returns null at the top edge of a vertical split", () => {
      expect(findNeighbor(vPair, "a", "up")).toBeNull();
    });

    it("returns null at the bottom edge of a vertical split", () => {
      expect(findNeighbor(vPair, "b", "down")).toBeNull();
    });

    it("returns null for fromId not present in the tree", () => {
      expect(findNeighbor(hPair, "missing", "right")).toBeNull();
    });

    it("returns null for a single-leaf tree regardless of direction", () => {
      const single = leaf("only");
      expect(findNeighbor(single, "only", "left")).toBeNull();
      expect(findNeighbor(single, "only", "right")).toBeNull();
      expect(findNeighbor(single, "only", "up")).toBeNull();
      expect(findNeighbor(single, "only", "down")).toBeNull();
    });

    it("descends into a nested sibling to find the first leaf (right)", () => {
      // split[ a , split[ b , c ] ] — right of "a" is the first leaf of the sibling.
      const tree: SplitNode = {
        type: "split",
        direction: "h",
        ratio: 0.5,
        left: leaf("a"),
        right: { type: "split", direction: "h", ratio: 0.5, left: leaf("b"), right: leaf("c") },
      };
      expect(findNeighbor(tree, "a", "right")).toBe("b");
    });

    it("descends into a nested sibling to find the last leaf (left)", () => {
      // split[ split[ a , b ] , c ] — left of "c" is the last leaf of the sibling.
      const tree: SplitNode = {
        type: "split",
        direction: "h",
        ratio: 0.5,
        left: { type: "split", direction: "h", ratio: 0.5, left: leaf("a"), right: leaf("b") },
        right: leaf("c"),
      };
      expect(findNeighbor(tree, "c", "left")).toBe("b");
    });

    it("traverses nested splits to find neighbour (right from 'a' crosses h-split at top level)", () => {
      // Layout: h-split [ v-split(a,c) | b ]
      const nested: SplitNode = {
        type: "split", direction: "h", ratio: 0.5,
        left: { type: "split", direction: "v", ratio: 0.5, left: leaf("a"), right: leaf("c") },
        right: leaf("b"),
      };
      // "a" is in the left subtree; its right neighbour at the h level is "b"
      expect(findNeighbor(nested, "a", "right")).toBe("b");
      // "b" left neighbour → last leaf of left subtree = "c"
      expect(findNeighbor(nested, "b", "left")).toBe("c");
      // "c" (bottom of v-split) → down should be null (c is in right of v-split)
      expect(findNeighbor(nested, "c", "down")).toBeNull();
      // "a" down → "c" (v-split same parent)
      expect(findNeighbor(nested, "a", "down")).toBe("c");
    });
  });
});
