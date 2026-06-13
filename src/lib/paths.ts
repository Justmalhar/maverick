// Joins a worktree root with a forward-slash relative path without producing a
// double separator when `root` already ends in "/" (or is the filesystem root).
// The sidecar emits forward-slash rels, so we normalise on "/" only.
export function joinPath(root: string, rel: string): string {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  return `${base}/${rel}`;
}
