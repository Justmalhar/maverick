import { aiBranchName } from "@/lib/tauri";
import { getAiBranchNames } from "@/lib/stores/settings";

// Resolves the {feature-name} for a task branch. When AI naming is enabled
// (general.aiBranchNames), asks the agent CLI for a concise name with a hard
// timeout; on disable, slow CLI, or any error it falls back to the task title
// (which applyNamingScheme then slugifies) — so workspace create never hangs.
const AI_TIMEOUT_MS = 8_000;

export async function resolveFeatureName(
  title: string,
  prompt: string,
  cwd?: string,
): Promise<string> {
  if (!getAiBranchNames()) return title;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ai-branch-name timeout")), AI_TIMEOUT_MS);
    });
    const result = await Promise.race([aiBranchName(prompt, cwd), timeout]);
    const name = result?.name?.trim();
    return name || title;
  } catch {
    return title;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
