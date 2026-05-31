import { useCallback } from "react";
import { useWorkbench, type TerminalTab } from "@/state/store";
import { ptySpawn, ptyKill, defaultShell } from "@/lib/tauri";

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function useTerminalTab() {
  const addTerminalTab = useWorkbench((s) => s.addTerminalTab);
  const removeTerminalTab = useWorkbench((s) => s.removeTerminalTab);
  const setActiveTerminalTab = useWorkbench((s) => s.setActiveTerminalTab);

  const open = useCallback(
    async (cwd: string): Promise<TerminalTab> => {
      const id = `term-${crypto.randomUUID()}`;
      const shell = await defaultShell();
      const { ptyId } = await ptySpawn(shell, ["-l"], cwd);
      const tab: TerminalTab = { id, cwd, title: basename(cwd) || cwd, ptyId };
      addTerminalTab(tab);
      setActiveTerminalTab(id);
      return tab;
    },
    [addTerminalTab, setActiveTerminalTab],
  );

  const close = useCallback(
    async (id: string): Promise<void> => {
      const tab = useWorkbench.getState().terminalTabs.find((t) => t.id === id);
      if (tab) {
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
