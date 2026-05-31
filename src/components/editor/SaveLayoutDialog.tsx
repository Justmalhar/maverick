import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Save the layout under the supplied name. Resolves when persisted. */
  onSave: (name: string) => Promise<void> | void;
  defaultName?: string;
}

/** Prompts for a preset name, then persists the active layout as a preset. */
export function SaveLayoutDialog({ open, onOpenChange, onSave, defaultName = "" }: Props) {
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();

  const submit = async () => {
    if (trimmed === "" || saving) return;
    setSaving(true);
    try {
      await onSave(trimmed);
      onOpenChange(false);
      setName("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="save-layout-dialog">
        <DialogHeader>
          <DialogTitle>Save layout as preset</DialogTitle>
          <DialogDescription>
            Store the current editor layout as a reusable preset, launchable from
            the preset launcher.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <Input
            autoFocus
            data-testid="save-layout-name"
            value={name}
            placeholder="Preset name"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              data-testid="save-layout-cancel"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="save-layout-confirm"
              disabled={trimmed === "" || saving}
            >
              {saving ? "Saving…" : "Save preset"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
