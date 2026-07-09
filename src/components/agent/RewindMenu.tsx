import { useState } from "react";
import { EllipsisVertical, History } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { agentRewind } from "@/lib/tauri";

interface Props {
  sessionId: string;
  messageId: string;
  messageText: string;
  onRewound: (messageText: string) => void;
}

export function RewindMenu({ sessionId, messageId, messageText, onRewound }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doRewind() {
    setBusy(true);
    try {
      await agentRewind(sessionId, messageId);
      setConfirming(false);
      onRewound(messageText);
    } catch (e) {
      console.error("[agent] rewind failed", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Message actions"
            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <EllipsisVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setConfirming(true)} className="text-[12px]">
            <History className="h-3.5 w-3.5" />
            Rewind to here
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rewind to this message?</DialogTitle>
            <DialogDescription>
              Restores the worktree files to the state before this message was sent and removes this and all later messages from the conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={() => void doRewind()} disabled={busy}>Rewind</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
