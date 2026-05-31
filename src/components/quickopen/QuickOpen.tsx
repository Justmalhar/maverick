import { useEffect, useState } from "react";
import { File } from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { fileSearch } from "@/lib/tauri";
import type { SearchHit } from "@/lib/ipc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

// Quiet-gap before issuing a search; keeps QuickOpen responsive while typing
// without firing a sidecar walk on every keystroke.
const SEARCH_DEBOUNCE_MS = 120;

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

// Joins a worktree root with a forward-slash relative path without producing a
// double separator when `root` already ends in "/" (or is the filesystem root
// "/"). The sidecar emits forward-slash rels, so we normalize on "/" only.
export function joinPath(root: string, rel: string): string {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  return `${base}/${rel}`;
}

export function QuickOpen() {
  const open = useWorkbench((s) => s.quickOpenOpen);
  const setOpen = useWorkbench((s) => s.setQuickOpenOpen);
  const openPreview = useWorkbench((s) => s.openPreview);
  const active = useWorkbench(selectActiveWorkspace);
  const worktree = active?.worktreePath ?? null;
  const [query, setQuery] = useState("");
  // Hits are stored with the worktree root that produced them so selection can
  // build an absolute path without re-reading the (possibly changed) store.
  const [result, setResult] = useState<{ root: string; hits: SearchHit[] }>({
    root: "",
    hits: [],
  });
  const [truncated, setTruncated] = useState(false);
  const hits = result.hits;

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResult({ root: "", hits: [] });
      setTruncated(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !worktree || query.trim() === "") {
      setResult({ root: "", hits: [] });
      setTruncated(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fileSearch(worktree, query, 100)
        .then((res) => {
          if (cancelled) return;
          setResult({ root: worktree, hits: res.hits });
          setTruncated(res.truncated);
        })
        .catch(() => {
          if (!cancelled) {
            setResult({ root: "", hits: [] });
            setTruncated(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, worktree]);

  const onSelect = (hit: SearchHit) => {
    openPreview({ path: joinPath(result.root, hit.rel), name: hit.name });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="left-[50%] top-[72px] w-[600px] max-w-[90vw] translate-x-[-50%] translate-y-0 gap-0 overflow-hidden border border-border-strong bg-popover p-0 shadow-lg"
      >
        <Command className="bg-popover" shouldFilter={false}>
          <CommandInput
            placeholder="Search files by name…"
            value={query}
            onValueChange={setQuery}
            data-testid="quickopen-input"
          />
          <CommandList>
            <CommandEmpty>No files found</CommandEmpty>
            <CommandGroup>
              {hits.map((hit) => (
                <CommandItem
                  key={hit.rel}
                  value={hit.rel}
                  onSelect={() => onSelect(hit)}
                  data-testid={`quickopen-item-${hit.rel}`}
                >
                  <File className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{hit.rel}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {truncated && (
              <div
                className="px-3 py-1.5 text-[11px] text-muted-foreground"
                data-testid="quickopen-truncated"
              >
                Results truncated — refine your query.
              </div>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export { basename };
