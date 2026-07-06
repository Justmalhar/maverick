// Send one prompt to every member workspace's live agent terminal.
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sendAgentPrompt } from "@/lib/ai-actions";
import type { Squad, Workspace } from "@/lib/ipc";

interface Props {
  open: boolean;
  squad: Squad | null;
  memberWorkspaces: Workspace[];
  onOpenChange: (open: boolean) => void;
  onAgentFocus?: (workspaceId: string) => void;
}

export default function SquadBroadcastDialog({ open, squad, memberWorkspaces, onOpenChange, onAgentFocus }: Props) {
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: string[]; unreachable: string[] } | null>(null);

  async function send() {
    if (!squad || !prompt.trim()) return;
    setSending(true);
    setResult(null);
    const sent: string[] = [];
    const unreachable: string[] = [];
    for (const ws of memberWorkspaces) {
      const { ran } = await sendAgentPrompt({
        target: { workspaceId: ws.id, backend: ws.agentBackend, cwd: ws.worktreePath },
        prompt,
        onAgentFocus: () => onAgentFocus?.(ws.id),
      });
      (ran ? sent : unreachable).push(ws.title || ws.branch);
    }
    setResult({ sent, unreachable });
    setSending(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setPrompt("");
          setResult(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent data-testid="squad-broadcast-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>Broadcast to {squad?.name}</DialogTitle>
          <DialogDescription>
            Sends this message to every member's live agent terminal ({memberWorkspaces.length} member
            {memberWorkspaces.length === 1 ? "" : "s"}).
          </DialogDescription>
        </DialogHeader>

        <textarea
          data-testid="squad-broadcast-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          autoFocus
          className="w-full resize-none rounded-sm border border-border bg-input p-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="What should the squad do?"
        />

        {result && (
          <div data-testid="squad-broadcast-result" className="space-y-1 text-[11px]">
            {result.sent.length > 0 && (
              <p className="text-success">Sent to: {result.sent.join(", ")}</p>
            )}
            {result.unreachable.length > 0 && (
              <p className="text-destructive">
                No live agent (start the workspace first): {result.unreachable.join(", ")}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} data-testid="squad-broadcast-close">
            Close
          </Button>
          <Button
            size="sm"
            disabled={!prompt.trim() || sending || memberWorkspaces.length === 0}
            onClick={send}
            data-testid="squad-broadcast-send"
          >
            {sending ? "Sending…" : "Send to squad"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
