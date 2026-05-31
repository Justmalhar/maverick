import { useMemo } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { File, FileText, FolderOpen, Folder, Files, ChevronRight, ChevronDown } from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { useFileTree, absPath } from "@/hooks/useFileTree";
import type { FileEntry } from "@/lib/ipc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<NonNullable<FileEntry["status"]>, string> = {
  M: "text-warning",
  A: "text-success",
  D: "text-destructive",
  R: "text-info",
};

// Above this many visible rows we virtualize via react-window (CLAUDE.md: lists
// >50 items). Below it the plain ScrollArea keeps the DOM simple and testable.
const VIRTUALIZE_THRESHOLD = 50;
const ROW_HEIGHT = 22;
// Fixed viewport for the virtualized list; the panel scrolls internally. Any
// list long enough to virtualize (>50 rows) overflows this, so react-window
// only mounts the visible window.
const VIRTUAL_VIEWPORT_HEIGHT = 600;

export interface FlatNode {
  entry: FileEntry;
  depth: number;
}

// Depth-first flatten honoring the expanded set: collapsed directories hide
// their subtree so the rendered list matches what the user sees.
export function flattenTree(
  entries: FileEntry[],
  expanded: Set<string>,
  depth = 0,
  acc: FlatNode[] = []
): FlatNode[] {
  for (const entry of entries) {
    acc.push({ entry, depth });
    if (entry.isDirectory && entry.children && expanded.has(entry.path)) {
      flattenTree(entry.children, expanded, depth + 1, acc);
    }
  }
  return acc;
}

interface RowProps {
  node: FlatNode;
  expanded: boolean;
  onToggle: (path: string) => void;
  onOpen: (entry: FileEntry) => void;
}

function FileRow({ node, expanded, onToggle, onOpen }: RowProps) {
  const { entry, depth } = node;
  const isDir = entry.isDirectory;
  const Icon = isDir
    ? expanded
      ? FolderOpen
      : Folder
    : entry.name.endsWith(".md")
      ? FileText
      : File;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group/row flex items-center gap-1 pr-2 text-xs text-sidebar-fg",
        "cursor-pointer transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px`, height: `${ROW_HEIGHT}px` }}
      data-testid={`file-node-${entry.path}`}
      onClick={() => (isDir ? onToggle(entry.path) : onOpen(entry))}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          isDir ? onToggle(entry.path) : onOpen(entry);
        }
      }}
    >
      {isDir ? (
        <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{entry.name}</span>
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
  const openPreview = useWorkbench((s) => s.openPreview);
  const { entries, expanded, toggle } = useFileTree(active?.worktreePath ?? null);

  const flat = useMemo(() => flattenTree(entries, expanded), [entries, expanded]);

  // entry.path is RELATIVE; PreviewView -> fileRead does an OS read, so resolve
  // to an ABSOLUTE path against the active worktree root before storing it.
  const onOpen = (entry: FileEntry) => {
    const root = active?.worktreePath;
    if (!root) return;
    openPreview({ path: absPath(root, entry.path), name: entry.name });
  };

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

  if (flat.length > VIRTUALIZE_THRESHOLD) {
    return (
      <div className="h-full" data-testid="files-view">
        <FixedSizeList
          height={VIRTUAL_VIEWPORT_HEIGHT}
          itemCount={flat.length}
          itemSize={ROW_HEIGHT}
          width="100%"
        >
          {({ index, style }: ListChildComponentProps) => {
            const node = flat[index];
            return (
              <div style={style}>
                <FileRow
                  node={node}
                  expanded={expanded.has(node.entry.path)}
                  onToggle={toggle}
                  onOpen={onOpen}
                />
              </div>
            );
          }}
        </FixedSizeList>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full" data-testid="files-view">
      <div className="py-1">
        {flat.map((node) => (
          <FileRow
            key={node.entry.path}
            node={node}
            expanded={expanded.has(node.entry.path)}
            onToggle={toggle}
            onOpen={onOpen}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
