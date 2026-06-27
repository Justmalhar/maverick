// Monaco/xterm need a concrete font-family STRING (they measure glyph metrics
// off-screen and can't resolve a bare `var(--font-mono)`), so canvas-based
// renderers can't just use the Tailwind `font-mono` class. This helper resolves
// the live value of the --font-mono design token at call time, keeping those
// renderers in sync with the theme instead of hardcoding a duplicate stack.
const MONO_FALLBACK =
  '"Geist Mono", ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", "Roboto Mono", Consolas, "Liberation Mono", monospace';

export function monoFontFamily(): string {
  if (typeof document === "undefined") return MONO_FALLBACK;
  const resolved = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-mono")
    .trim();
  return resolved || MONO_FALLBACK;
}
