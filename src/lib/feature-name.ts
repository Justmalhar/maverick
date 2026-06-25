import { aiBranchName } from "@/lib/tauri";
import { applyNamingScheme } from "@/lib/branch-name";
import { getAiBranchNames, getNamingScheme } from "@/lib/stores/settings";

// Resolves the {feature-name} for a task branch. When AI naming is enabled
// (general.aiBranchNames), asks the agent CLI for a concise name with a hard
// timeout; on disable, slow CLI, or any error it falls back to the task title
// (which applyNamingScheme then slugifies) — so workspace create never hangs.
const AI_TIMEOUT_MS = 8_000;

export async function resolveFeatureName(
  title: string,
  prompt: string,
  cwd?: string,
  instructions?: string,
): Promise<string> {
  if (!getAiBranchNames()) return title;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ai-branch-name timeout")), AI_TIMEOUT_MS);
    });
    const result = await Promise.race([aiBranchName(prompt, cwd, instructions), timeout]);
    const name = result?.name?.trim();
    return name || title;
  } catch {
    return title;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Resolves the final git branch name for a task-launched workspace.
// - With a project `branchRename` preference (instructions), the AI returns a
//   full convention-following name (e.g. "feature/login-page") used as-is.
// - Without, the AI returns a {feature-name} fragment that the global naming
//   scheme wraps (e.g. "maverick/login-page").
// Falls back to the title slugged into the global scheme when AI is off/slow/down,
// so a branch name is always produced — never a random callsign.
export async function resolveTaskBranch(args: {
  title: string;
  prompt: string;
  cwd?: string;
  backend?: string;
  instructions?: string;
}): Promise<string> {
  const instructions = args.instructions?.trim() || undefined;
  if (getAiBranchNames()) {
    const aiName = await resolveAiName(args.prompt, args.cwd, instructions);
    if (aiName) {
      return instructions
        ? aiName
        : applyNamingScheme(getNamingScheme(), { featureName: aiName, backend: args.backend });
    }
  }
  return applyNamingScheme(getNamingScheme(), { featureName: args.title, backend: args.backend });
}

async function resolveAiName(
  prompt: string,
  cwd?: string,
  instructions?: string,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ai-branch-name timeout")), AI_TIMEOUT_MS);
    });
    const result = await Promise.race([aiBranchName(prompt, cwd, instructions), timeout]);
    return result?.name?.trim() ?? "";
  } catch {
    return "";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
