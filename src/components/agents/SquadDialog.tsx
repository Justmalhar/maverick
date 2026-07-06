// Create/edit a Squad — name, leader, and member workspaces from one project.
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Squad, Workspace } from "@/lib/ipc";

interface Props {
  open: boolean;
  squad?: Partial<Squad>;
  /** Workspaces in the squad's project — the pool leader/members are picked from. */
  projectWorkspaces: Workspace[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (squad: Partial<Squad>) => void;
  onDelete?: (id: string) => void;
}

const NO_LEADER = "__none__";

export default function SquadDialog({ open, squad, projectWorkspaces, onOpenChange, onSubmit, onDelete }: Props) {
  const [name, setName] = useState("");
  const [leaderWorkspaceId, setLeaderWorkspaceId] = useState<string>(NO_LEADER);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setName(squad?.name ?? "");
    setLeaderWorkspaceId(squad?.leaderWorkspaceId ?? NO_LEADER);
    setMemberIds(new Set(squad?.memberWorkspaceIds ?? []));
  }, [open, squad]);

  function toggleMember(id: string, checked: boolean) {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const submit = () => {
    if (!name.trim()) return;
    const leaderId = leaderWorkspaceId === NO_LEADER ? undefined : leaderWorkspaceId;
    // A leader must also be a member — it's still one of the workspaces doing
    // the work, just the one the human treats as primary.
    const members = new Set(memberIds);
    if (leaderId) members.add(leaderId);
    onSubmit({
      ...(squad?.id ? { id: squad.id } : {}),
      ...(squad?.projectId ? { projectId: squad.projectId } : {}),
      name: name.trim(),
      leaderWorkspaceId: leaderId,
      memberWorkspaceIds: [...members],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="squad-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{squad?.id ? "Edit squad" : "New squad"}</DialogTitle>
          <DialogDescription>
            Group related workspaces so you can broadcast a task to all of them at once.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">Name</label>
          <Input data-testid="squad-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">Leader</label>
          <Select value={leaderWorkspaceId} onValueChange={setLeaderWorkspaceId}>
            <SelectTrigger data-testid="squad-leader">
              <SelectValue placeholder="No leader" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_LEADER}>No leader</SelectItem>
              {projectWorkspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.title || w.branch}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">Members</label>
          {projectWorkspaces.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No workspaces in this project yet.</p>
          ) : (
            <div className="space-y-1.5">
              {projectWorkspaces.map((w) => (
                <label key={w.id} className="flex items-center gap-2 text-[12px]" data-testid={`squad-member-row-${w.id}`}>
                  <Checkbox
                    checked={memberIds.has(w.id) || w.id === leaderWorkspaceId}
                    disabled={w.id === leaderWorkspaceId}
                    onCheckedChange={(checked) => toggleMember(w.id, checked === true)}
                    data-testid={`squad-member-${w.id}`}
                  />
                  {w.title || w.branch}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          {squad?.id && onDelete && (
            <Button
              variant="outline"
              size="sm"
              className="mr-auto text-destructive hover:text-destructive"
              data-testid="squad-delete"
              onClick={() => {
                if (window.confirm("Delete this squad? This cannot be undone.")) onDelete(squad.id!);
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!name.trim()} onClick={submit} data-testid="squad-submit">
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
