// Backends with a verified headless mode — mirrors the sidecar AgentRunner's
// supportsHeadless. A backend not listed here falls back to the interactive
// terminal launch surface rather than attempting a broken headless spawn.
const HEADLESS_BACKENDS = new Set<string>(["claude-code"]);

export function supportsHeadlessLaunch(backend: string): boolean {
  return HEADLESS_BACKENDS.has(backend);
}
