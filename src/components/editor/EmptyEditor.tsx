import { FolderPlus, Rocket, Command as CommandIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useWorkbench } from "@/state/store";
import { useWorkspace } from "@/hooks/useWorkspace";
import { pickProjectFolder } from "@/lib/dialog";
import { cn } from "@/lib/utils";

export function EmptyEditor() {
  const reduce = useReducedMotion();
  const setCommandPaletteOpen = useWorkbench((s) => s.setCommandPaletteOpen);
  const setPresetLauncherOpen = useWorkbench((s) => s.setPresetLauncherOpen);
  const showPrimarySideBar = useWorkbench((s) => s.showPrimarySideBar);
  const { addProjectFromPath } = useWorkspace();

  async function onAddProject() {
    showPrimarySideBar();
    const path = await pickProjectFolder();
    if (!path) return;
    try {
      await addProjectFromPath(path);
    } catch (e) {
      console.error("addProject failed", e);
    }
  }

  return (
    <motion.div
      data-testid="empty-editor"
      className="flex h-full w-full items-center justify-center overflow-auto bg-editor"
      initial={reduce ? false : { opacity: 0 }}
      animate={reduce ? undefined : { opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-8 px-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <img
            src="/app-icon.png"
            alt="Maverick"
            className="h-16 w-16 rounded-2xl"
            draggable={false}
          />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Maverick
            </h1>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2">
          <QuickAction
            icon={FolderPlus}
            label="Add project"
            shortcut="⌘O"
            onClick={onAddProject}
            testId="empty-add-project"
          />
          <QuickAction
            icon={Rocket}
            label="Open preset"
            shortcut="⌘⇧Space"
            onClick={() => setPresetLauncherOpen(true)}
            testId="empty-presets"
          />
          <QuickAction
            icon={CommandIcon}
            label="Command palette"
            shortcut="⌘⇧P"
            onClick={() => setCommandPaletteOpen(true)}
            testId="empty-commands"
          />
        </div>
      </div>
    </motion.div>
  );
}

interface QuickActionProps {
  icon: typeof FolderPlus;
  label: string;
  shortcut?: string;
  onClick: () => void;
  testId?: string;
}

function QuickAction({ icon: Icon, label, shortcut, onClick, testId }: QuickActionProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg border border-border-glass bg-card px-4 py-3 text-left",
        "transition-colors duration-150 hover:border-border-glass-strong hover:bg-muted",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors duration-100 group-hover:text-foreground" />
      <span className="flex-1 text-[13px] text-foreground">{label}</span>
      {shortcut && (
        <kbd className="text-[10px] tracking-wide text-muted-foreground">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
