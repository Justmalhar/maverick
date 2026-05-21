// Add/edit Kanban task — title, description (markdown), status, labels, due date.
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
import { Badge } from "@/components/ui/badge";
import type { KanbanTask } from "@/lib/ipc";

interface Props {
  open: boolean;
  task?: Partial<KanbanTask>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (task: Partial<KanbanTask>) => void;
}

const STATUSES: KanbanTask["status"][] = ["backlog", "in_progress", "review", "done"];

export default function KanbanTaskDialog({ open, task, onOpenChange, onSubmit }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<KanbanTask["status"]>("backlog");
  const [labelInput, setLabelInput] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    if (open) {
      setTitle(task?.title ?? "");
      setDescription(task?.description ?? "");
      setStatus(task?.status ?? "backlog");
      setLabels(task?.labels ?? []);
      setLabelInput("");
      setDueDate(task?.dueDate ? new Date(task.dueDate * 1000).toISOString().slice(0, 10) : "");
    }
  }, [open, task]);

  const addLabel = () => {
    const trimmed = labelInput.trim();
    if (!trimmed || labels.includes(trimmed)) return;
    setLabels([...labels, trimmed]);
    setLabelInput("");
  };

  const submit = () => {
    if (!title.trim()) return;
    const payload: Partial<KanbanTask> = {
      ...(task?.id ? { id: task.id } : {}),
      title: title.trim(),
      description,
      status,
      labels,
      ...(dueDate ? { dueDate: Math.floor(new Date(dueDate).getTime() / 1000) } : {}),
      ...(task?.projectId ? { projectId: task.projectId } : {}),
      ...(task?.columnOrder !== undefined ? { columnOrder: task.columnOrder } : {}),
    };
    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="kanban-task-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{task?.id ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>Track work for this project.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Title
          </label>
          <Input
            data-testid="kanban-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Description (markdown)
          </label>
          <textarea
            data-testid="kanban-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-sm border border-border bg-input p-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Status
          </label>
          <div className="flex gap-1.5">
            {STATUSES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={status === s ? "default" : "outline"}
                onClick={() => setStatus(s)}
                data-testid={`status-${s}`}
              >
                {s.replace("_", " ")}
              </Button>
            ))}
          </div>

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Labels
          </label>
          <div className="flex gap-2">
            <Input
              data-testid="kanban-label-input"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLabel())}
              placeholder="Add label and press Enter"
            />
            <Button size="sm" variant="outline" onClick={addLabel}>
              Add
            </Button>
          </div>
          {labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {labels.map((l) => (
                <Badge
                  key={l}
                  variant="outline"
                  onClick={() => setLabels(labels.filter((x) => x !== l))}
                  className="cursor-pointer"
                >
                  {l} ×
                </Badge>
              ))}
            </div>
          )}

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Due date
          </label>
          <Input
            type="date"
            data-testid="kanban-due"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!title.trim()}
            onClick={submit}
            data-testid="kanban-submit"
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
