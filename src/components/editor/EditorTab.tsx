import { X, Bot, TerminalSquare } from "lucide-react";
import { useWorkbench, selectEditorMode } from "@/state/store";
import type { Workspace } from "@/lib/ipc";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { brandFor } from "@/lib/backend-brand";
import { AgentStatusPill } from "./AgentStatusPill";
import { cn } from "@/lib/utils";

interface Props {
  workspace: Workspace;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function EditorTab({ workspace, active, onSelect, onClose, onContextMenu }: Props) {
  const mode = useWorkbench(selectEditorMode(workspace.id));
  const agentStatus = useAgentStatus(workspace.id);
  // Agent mode wears the backend's brand mark (Claude, Codex, …); terminal
  // mode keeps the terminal glyph since the icon then signals mode, not brand.
  const brand = mode === "terminal" ? undefined : brandFor(workspace.agentBackend);
  const ModeIcon = mode === "terminal" ? TerminalSquare : Bot;

  return (
    <div
      data-testid={`editor-tab-${workspace.id}`}
      data-active={active ? "true" : "false"}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "mv-editor-tab group flex shrink-0 cursor-pointer select-none items-center gap-1.5 pl-3 pr-2 text-[12px]",
        "transition-colors duration-100",
        active
          ? "bg-tab-active text-tab-fg-active"
          : "bg-tab-inactive text-tab-fg hover:bg-foreground/5 hover:text-foreground"
      )}
    >
      {brand ? (
        <span
          data-testid={`editor-tab-brand-${workspace.id}`}
          title={brand.label}
          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
        >
          <brand.Icon size={13} />
        </span>
      ) : (
        <ModeIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
      )}
      <span className="max-w-[160px] truncate">
        {workspace.title ?? workspace.branch}
      </span>
      <AgentStatusPill status={agentStatus} compact />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close workspace"
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-sm opacity-0 transition-opacity duration-100",
          "hover:bg-sidebar-hover group-hover:opacity-100",
          active && "opacity-70"
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
