// Create/edit an Autopilot — name, backend, branch, prompt, recurring interval.
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Autopilot, Backend } from "@/lib/ipc";

interface Props {
  open: boolean;
  autopilot?: Partial<Autopilot>;
  backends: Backend[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (autopilot: Partial<Autopilot>) => void;
  onDelete?: (id: string) => void;
}

export default function AutopilotDialog({ open, autopilot, backends, onOpenChange, onSubmit, onDelete }: Props) {
  const [name, setName] = useState("");
  const [backend, setBackend] = useState("");
  const [branch, setBranch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(autopilot?.name ?? "");
    setBackend(autopilot?.backend || backends.find((b) => b.active)?.id || backends[0]?.id || "");
    setBranch(autopilot?.branch ?? "");
    setPrompt(autopilot?.prompt ?? "");
    setRecurring(autopilot?.intervalMinutes != null);
    setIntervalMinutes(String(autopilot?.intervalMinutes ?? 60));
    setEnabled(autopilot?.enabled ?? true);
  }, [open, autopilot, backends]);

  const submit = () => {
    if (!name.trim()) return;
    const minutes = Math.max(1, Math.floor(Number(intervalMinutes)) || 60);
    onSubmit({
      ...(autopilot?.id ? { id: autopilot.id } : {}),
      ...(autopilot?.projectId ? { projectId: autopilot.projectId } : {}),
      name: name.trim(),
      backend,
      branch,
      prompt,
      intervalMinutes: recurring ? minutes : null,
      enabled,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="autopilot-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{autopilot?.id ? "Edit autopilot" : "New autopilot"}</DialogTitle>
          <DialogDescription>
            Runs a task in the background — on a schedule, on demand, or via webhook.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">Name</label>
          <Input data-testid="autopilot-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">Backend</label>
          <Select value={backend} onValueChange={setBackend}>
            <SelectTrigger data-testid="autopilot-backend">
              <SelectValue placeholder="Agent backend" />
            </SelectTrigger>
            <SelectContent>
              {backends.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">Branch</label>
          <Input
            data-testid="autopilot-branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="Blank = auto-generated"
          />

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">Prompt</label>
          <textarea
            data-testid="autopilot-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-sm border border-border bg-input p-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="What should the agent do each run?"
          />

          <div className="flex items-center justify-between pt-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Recurring schedule
            </label>
            <Switch checked={recurring} onCheckedChange={setRecurring} data-testid="autopilot-recurring" />
          </div>
          {recurring && (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                data-testid="autopilot-interval"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value)}
                className="w-24"
              />
              <span className="text-[11px] text-muted-foreground">minutes between runs</span>
            </div>
          )}
          {!recurring && (
            <p className="text-[11px] text-muted-foreground">
              Manual and webhook triggers still work without a schedule.
            </p>
          )}

          <div className="flex items-center justify-between pt-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Enabled</label>
            <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="autopilot-enabled" />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {autopilot?.id && onDelete && (
            <Button
              variant="outline"
              size="sm"
              className="mr-auto text-destructive hover:text-destructive"
              data-testid="autopilot-delete"
              onClick={() => {
                if (window.confirm("Delete this autopilot? This cannot be undone.")) onDelete(autopilot.id!);
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!name.trim()} onClick={submit} data-testid="autopilot-submit">
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
