import { getIconForFilePath, getIconForDirectoryPath } from "vscode-material-icons";

// VSCode Material Icon Theme SVGs ship inside the package's `generated/icons`
// dir. We resolve them through Vite's asset pipeline so each icon becomes a
// hashed, browser-cached static file — only the icons actually rendered are
// fetched, and none of the 3.7MB of SVG bloats the JS bundle.
const ICON_BASE = "/node_modules/vscode-material-icons/generated/icons/";
const ICON_URLS = import.meta.glob<string>(
  "/node_modules/vscode-material-icons/generated/icons/*.svg",
  { query: "?no-inline", import: "default", eager: true }
);

// `file` is Material's generic unknown-file glyph; it always exists, so this is
// a safe terminal fallback whenever a resolved icon name has no asset.
export function iconUrl(icon: string): string {
  return ICON_URLS[`${ICON_BASE}${icon}.svg`] ?? ICON_URLS[`${ICON_BASE}file.svg`];
}

export function fileIconUrl(name: string): string {
  return iconUrl(getIconForFilePath(name));
}

export function folderIconUrl(name: string, expanded: boolean): string {
  const base = getIconForDirectoryPath(name);
  return iconUrl(expanded ? `${base}-open` : base);
}
