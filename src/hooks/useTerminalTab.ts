import { useCallback } from "react";
import { useWorkbench, type TerminalTab } from "@/state/store";
import { ptySpawn, ptyKill } from "@/lib/tauri";
import { resolveShell, type ShellKind } from "@/lib/terminal-shell";
import { getDefaultShellKind, getGlobalEnv } from "@/lib/stores/settings";

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function useTerminalTab() {
  const addTerminalTab = useWorkbench((s) => s.addTerminalTab);
  const removeTerminalTab = useWorkbench((s) => s.removeTerminalTab);
  const setActiveTerminalTab = useWorkbench((s) => s.setActiveTerminalTab);
  const setTerminalTabPty = useWorkbench((s) => s.setTerminalTabPty);

  const open = useCallback(
    async (cwd: string, kind?: ShellKind): Promise<TerminalTab> => {
      const id = `term-${crypto.randomUUID()}`;
      // Optimistic: show + focus the tab immediately (ptyId "" = spawning) so the
      // click feels instant. The PTY spawn runs in the background; the pane mounts
      // once its ptyId lands (see EditorGroup).
      const tab: TerminalTab = { id, cwd, title: basename(cwd) || cwd, ptyId: "" };
      addTerminalTab(tab);
      setActiveTerminalTab(id);
      try {
        // Mirror TerminalLeaf: an explicit pick wins, else the persisted default
        // shell, else the platform default. Resolution is synchronous.
        const { shell, args } = resolveShell(kind ?? getDefaultShellKind());
        const { ptyId } = await ptySpawn(shell, args, cwd, getGlobalEnv());
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
