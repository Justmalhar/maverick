import { aiBranchNameFromDiff, gitRenameBranch } from "@/lib/tauri";

// Names a workspace's branch from the work done in it (last commit + diff) and
// renames it via `git branch -m`, honoring the project's branchRename preference.
// Best-effort: returns the new branch on success, null on any failure (a failed
// auto-rename must never block the commit flow).
export async function renameWorkspaceBranchWithAI(args: {
  worktreePath: string;
  instructions?: string;
  backend?: string;
}): Promise<string | null> {
  try {
    const { name } = await aiBranchNameFromDiff(args.worktreePath, args.instructions, args.backend);
    if (!name) return null;
    await gitRenameBranch(args.worktreePath, name);
    return name;
  } catch {
    return null;
  }
}
