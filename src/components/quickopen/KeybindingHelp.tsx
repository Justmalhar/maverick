import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import KeybindingsSettings from "@/panels/settings/sections/KeybindingsSettings";
import { useWorkbench } from "@/state/store";

// Global keybinding reference (⌘⇧? / Ctrl+Shift+/). Reuses the read-only
// keybindings table from Settings so there is a single source of truth.
export function KeybindingHelp() {
  const open = useWorkbench((s) => s.keybindingHelpOpen);
  const setOpen = useWorkbench((s) => s.setKeybindingHelpOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-testid="keybinding-help"
        className="left-[50%] top-[72px] max-h-[80vh] w-[640px] max-w-[90vw] translate-x-[-50%] translate-y-0 gap-0 overflow-y-auto border border-border-strong bg-popover p-4 shadow-lg"
      >
        <DialogTitle className="text-sm text-foreground">Keyboard Shortcuts</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          Every shortcut Maverick listens for. Press Esc to close.
        </DialogDescription>
        <div className="mt-3">
          <KeybindingsSettings />
        </div>
      </DialogContent>
    </Dialog>
  );
}
