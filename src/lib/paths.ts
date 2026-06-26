// Joins a worktree root with a forward-slash relative path without producing a
// double separator when `root` already ends in "/" (or is the filesystem root).
// The sidecar emits forward-slash rels, so we normalise on "/" only.
export function joinPath(root: string, rel: string): string {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  return `${base}/${rel}`;
}

// Last forward-slash-delimited segment of a path (the file name). Mirrors the
// sidecar's forward-slash convention; returns the input unchanged when there is
// no separator.
export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}
