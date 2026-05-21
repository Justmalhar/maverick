import { describe, it, expect } from "vitest";
import {
  countLeaves, canSplit, findNode, removeNode, splitNode, defaultSixPaneLayout,
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
});
