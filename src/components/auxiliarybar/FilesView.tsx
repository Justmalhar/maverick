import { useEffect, useState } from "react";
import { File, FileText, FolderOpen, Folder, Files } from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { fileTree } from "@/lib/tauri";
import type { FileEntry } from "@/lib/ipc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<NonNullable<FileEntry["status"]>, string> = {
  M: "text-warning",
  A: "text-success",
  D: "text-destructive",
  R: "text-info",
};

function FileNode({ entry, depth }: { entry: FileEntry; depth: number }) {
  const Icon = entry.isDirectory
    ? FolderOpen
    : entry.name.endsWith(".md")
      ? FileText
      : File;
  return (
    <div>
      <div
        className={cn(
          "group/row flex items-center gap-1.5 pr-2 text-xs text-sidebar-fg",
          "cursor-pointer transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
        )}
        style={{
          paddingLeft: `${depth * 12 + 8}px`,
          height: "22px",
        }}
        data-testid={`file-node-${entry.path}`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate flex-1">{entry.name}</span>
        {entry.status && (
          <span
            className={cn(
              "text-[10px] font-semibold leading-none",
              STATUS_COLOR[entry.status]
            )}
          >
            {entry.status}
          </span>
        )}
      </div>
      {entry.children?.map((child) => (
        <FileNode key={child.path} entry={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Files;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
      <span className="text-[13px] text-foreground">{title}</span>
      <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function FilesView() {
  const active = useWorkbench(selectActiveWorkspace);
  const [entries, setEntries] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (!active?.worktreePath) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    fileTree(active.worktreePath)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.worktreePath]);

  if (!active) {
    return (
      <EmptyState
        icon={Files}
        title="No active workspace"
        hint="Open a workspace from a project to browse its file tree."
      />
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Folder}
        title="Empty worktree"
        hint="This worktree contains no files yet."
      />
    );
  }

  return (
    <ScrollArea className="h-full" data-testid="files-view">
      <div className="py-1">
        {entries.map((e) => (
          <FileNode key={e.path} entry={e} depth={0} />
        ))}
      </div>
    </ScrollArea>
  );
}
