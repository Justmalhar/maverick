import { FileText, GitCompareArrows, X } from "lucide-react";
import type { FileTab } from "@/state/store";
import { cn } from "@/lib/utils";

interface Props {
  tab: FileTab;
  active: boolean;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
}

export function FileEditorTab({ tab, active, onSelect, onPin, onClose }: Props) {
  const name = tab.path.split("/").pop() ?? tab.path;
  const Icon = tab.kind === "diff" ? GitCompareArrows : FileText;
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onPin}
      data-testid={`editor-tab-file-${tab.id}`}
      className={cn(
        "group relative flex min-w-[110px] items-center gap-1.5 px-3 text-[12px] transition-colors duration-100",
        active
          ? "bg-tab-active text-tab-fg-active"
          : "bg-tab-inactive text-tab-fg hover:bg-foreground/5 hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span className={cn("flex-1 truncate text-left", tab.preview && "italic")}>{name}</span>
      {tab.dirty ? (
        <span
          role="button"
          tabIndex={0}
          data-testid={`file-tab-dirty-${tab.id}`}
          aria-label={`Close ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onClose();
            }
          }}
          className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center"
        >
          <span className="h-2 w-2 rounded-full bg-foreground" />
        </span>
      ) : (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Close ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onClose();
            }
          }}
          className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 data-[active=true]:opacity-60"
          data-active={active}
        >
          <X className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}
