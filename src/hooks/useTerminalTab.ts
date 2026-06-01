import { useCallback } from "react";
import { useWorkbench, type TerminalTab } from "@/state/store";
import { ptySpawn, ptyKill, defaultShell } from "@/lib/tauri";

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

// The login shell is constant for a session, so resolve it once and share the
// in-flight promise — repeat opens skip the IPC round-trip. A failed lookup
// clears the cache so the next open retries rather than caching the rejection.
let shellPromise: Promise<string> | null = null;
function resolveShell(): Promise<string> {
  if (!shellPromise) {
    shellPromise = defaultShell().catch((err) => {
      shellPromise = null;
      throw err;
    });
  }
  return shellPromise;
}

/** Test-only: drop the cached shell so each test starts cold. */
export function __resetTerminalShellCacheForTests(): void {
  shellPromise = null;
}

export function useTerminalTab() {
  const addTerminalTab = useWorkbench((s) => s.addTerminalTab);
  const removeTerminalTab = useWorkbench((s) => s.removeTerminalTab);
  const setActiveTerminalTab = useWorkbench((s) => s.setActiveTerminalTab);
  const setTerminalTabPty = useWorkbench((s) => s.setTerminalTabPty);

  const open = useCallback(
    async (cwd: string): Promise<TerminalTab> => {
      const id = `term-${crypto.randomUUID()}`;
      // Optimistic: show + focus the tab immediately (ptyId "" = spawning) so the
      // click feels instant. The PTY and its slow login-shell startup run in the
      // background; the pane mounts once its ptyId lands (see EditorGroup).
      const tab: TerminalTab = { id, cwd, title: basename(cwd) || cwd, ptyId: "" };
      addTerminalTab(tab);
      setActiveTerminalTab(id);
      try {
        const shell = await resolveShell();
        const { ptyId } = await ptySpawn(shell, ["-l"], cwd);
        setTerminalTabPty(id, ptyId);
        return { ...tab, ptyId };
      } catch (err) {
        // Spawn failed — roll back the optimistic tab and let the caller report.
        removeTerminalTab(id);
        throw err;
      }
    },
    [addTerminalTab, setActiveTerminalTab, setTerminalTabPty, removeTerminalTab],
  );

  const close = useCallback(
    async (id: string): Promise<void> => {
      const tab = useWorkbench.getState().terminalTabs.find((t) => t.id === id);
      if (tab?.ptyId) {
        try {
          await ptyKill(tab.ptyId);
        } catch {
          // PTY may already be dead — proceed to remove the tab regardless.
        }
      }
      removeTerminalTab(id);
    },
    [removeTerminalTab],
  );

  return { open, close };
}
