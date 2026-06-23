// Composes the prompt handed to a task-launched agent. Project AI preferences
// (project.preferences — a category→guidance map) are prepended as a compact
// preamble so the agent honors them. Ephemeral: nothing is written to the repo.

/**
 * A compact preamble of project AI preferences. Returns "" when there are no
 * non-blank preferences. Keys are sorted for deterministic output.
 */
export function formatPreferences(prefs: Record<string, string>): string {
  const entries = Object.entries(prefs)
    .filter(([, v]) => v.trim() !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "";
  const lines = entries.map(([k, v]) => `- ${k}: ${v.trim()}`);
  return `[Project preferences]\n${lines.join("\n")}`;
}

/** Prepend the preferences preamble to a task prompt; unchanged when empty. */
export function buildLaunchPrompt(prefs: Record<string, string>, taskPrompt: string): string {
  const preamble = formatPreferences(prefs);
  return preamble ? `${preamble}\n\n${taskPrompt}` : taskPrompt;
}
