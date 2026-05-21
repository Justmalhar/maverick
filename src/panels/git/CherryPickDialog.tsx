// Cherry-pick dialog: enter SHA(s) or select from recent commits.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worktreePath: string;
}

export default function CherryPickDialog({ open, onOpenChange, worktreePath }: Props) {
  const [sha, setSha] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSha("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const run = async () => {
    if (!sha.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("git_cherry_pick", { worktreePath, sha: sha.trim() });
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="cherrypick-dialog">
        <DialogHeader>
          <DialogTitle>Cherry-pick commit</DialogTitle>
          <DialogDescription>
            Apply the changes from a commit on top of the current branch.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Input
            data-testid="cherrypick-sha"
            value={sha}
            onChange={(e) => setSha(e.target.value)}
            placeholder="Commit SHA (e.g. a1b2c3d)"
            autoFocus
          />
          {error && <div className="text-[11px] text-destructive">{error}</div>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!sha.trim() || busy}
            onClick={run}
            data-testid="cherrypick-confirm"
          >
            Cherry-pick
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
