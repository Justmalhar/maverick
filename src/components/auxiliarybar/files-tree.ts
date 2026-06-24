import type { FileEntry } from "@/lib/ipc";

// Tree-flattening for FilesView, kept out of the component module so FilesView.tsx
// exports only its component (Fast Refresh requirement).

export interface FlatNode {
  entry: FileEntry;
  depth: number;
}

// Depth-first flatten honoring the expanded set: collapsed directories hide
// their subtree so the rendered list matches what the user sees.
export function flattenTree(
  entries: FileEntry[],
  expanded: Set<string>,
  depth = 0,
  acc: FlatNode[] = []
): FlatNode[] {
  for (const entry of entries) {
    acc.push({ entry, depth });
    if (entry.isDirectory && entry.children && expanded.has(entry.path)) {
      flattenTree(entry.children, expanded, depth + 1, acc);
    }
  }
  return acc;
}
