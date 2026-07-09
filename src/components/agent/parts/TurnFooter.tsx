import { Copy } from "lucide-react";
import type { AgentFileChange } from "@/lib/ipc";
import type { TurnMeta } from "@/state/agent-store";
import { FileChangeChip } from "./FileChangeChip";

export function formatTurnDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

interface TurnFooterProps {
  turnId: string;
  meta?: TurnMeta;
  answerText: string;
  fileChanges: AgentFileChange[];
  onOpenFile?: (path: string) => void;
}

export function TurnFooter({ turnId, meta, answerText, fileChanges, onOpenFile }: TurnFooterProps) {
  if (!meta && fileChanges.length === 0 && !answerText.trim()) return null;

  function handleCopy() {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(answerText).catch(console.error);
  }

  return (
    <div
      className="mv-turnfooter flex flex-wrap items-center gap-2 py-1 text-[11px] text-muted-foreground"
      data-testid={`turn-footer-${turnId}`}
    >
      {meta && <span>{formatTurnDuration(meta.usage.durationMs)}</span>}
      <button
        type="button"
        aria-label="Copy answer"
        onClick={handleCopy}
        className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-muted hover:text-foreground"
      >
        <Copy className="h-3 w-3" />
      </button>
      {fileChanges.map((change) => (
        <FileChangeChip key={change.path} change={change} onOpen={onOpenFile} />
      ))}
      {meta?.unknownLines ? (
        <span title="The provider emitted lines this client version didn't understand.">
          {meta.unknownLines} unrecognized events
        </span>
      ) : null}
    </div>
  );
}
