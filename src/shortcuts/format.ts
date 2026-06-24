import type { OSPlatform } from "@/hooks/useOSPlatform";

// Windows/Linux have no Command (⌘) key — they use Ctrl/Alt/Shift (and the
// Windows/Super key). Only macOS renders the glyph chord (⌘⇧K); elsewhere we
// render the conventional "Ctrl+Shift+K" form. Key *handling* is unaffected —
// tinykeys maps `$mod` to ⌘ on macOS and Ctrl elsewhere; this is display-only.
function formatToken(token: string, mac: boolean): string {
  switch (token) {
    case "$mod":
      return mac ? "⌘" : "Ctrl";
    case "Meta":
      return mac ? "⌘" : "Win";
    case "Shift":
      return mac ? "⇧" : "Shift";
    case "Alt":
      return mac ? "⌥" : "Alt";
    case "Ctrl":
      return mac ? "⌃" : "Ctrl";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "Enter":
      return mac ? "⏎" : "Enter";
    case "Space":
      return "Space";
    default:
      return token.length === 1 ? token.toUpperCase() : token;
  }
}

/**
 * Render a canonical tinykeys binding (e.g. `$mod+Shift+k`, `$mod+Alt+ArrowLeft`,
 * or a `] c` sequence) for the given platform. macOS glues glyphs (`⌘⇧K`);
 * Windows/Linux use the `Ctrl+Shift+K` convention. Space-separated chord
 * sequences stay space-separated.
 */
export function formatKeybinding(keys: string, platform: OSPlatform): string {
  if (!keys) return "";
  const mac = platform === "macos";
  return keys
    .split(" ")
    .map((chord) =>
      chord
        .split("+")
        .map((token) => formatToken(token, mac))
        .join(mac ? "" : "+")
    )
    .join(" ");
}
