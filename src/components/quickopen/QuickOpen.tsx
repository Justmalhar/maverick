import { useEffect, useState } from "react";
import { File } from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { fileTree } from "@/lib/tauri";
import type { FileEntry } from "@/lib/ipc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

function flatten(entries: FileEntry[], acc: FileEntry[] = []): FileEntry[] {
  for (const e of entries) {
    if (!e.isDirectory) acc.push(e);
    if (e.children) flatten(e.children, acc);
  }
  return acc;
}

export function QuickOpen() {
  const open = useWorkbench((s) => s.quickOpenOpen);
  const setOpen = useWorkbench((s) => s.setQuickOpenOpen);
  const active = useWorkbench(selectActiveWorkspace);
  const [files, setFiles] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (!open || !active?.worktreePath) return;
    fileTree(active.worktreePath)
      .then((list) => setFiles(flatten(list)))
      .catch(() => setFiles([]));
  }, [open, active?.worktreePath]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="left-[50%] top-[72px] w-[600px] max-w-[90vw] translate-x-[-50%] translate-y-0 gap-0 overflow-hidden border border-border-strong bg-popover p-0 shadow-lg"
      >
        <Command className="bg-popover">
          <CommandInput
            placeholder="Search files by name…"
            data-testid="quickopen-input"
          />
          <CommandList>
            <CommandEmpty>No files found</CommandEmpty>
            <CommandGroup>
              {files.slice(0, 100).map((f) => (
                <CommandItem
                  key={f.path}
                  value={f.path}
                  onSelect={() => setOpen(false)}
                  data-testid={`quickopen-item-${f.path}`}
                >
                  <File className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{f.path}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
