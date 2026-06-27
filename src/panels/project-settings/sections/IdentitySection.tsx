import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SettingsGroup } from "@/panels/settings/primitives/SettingsGroup";
import { SettingsRow } from "@/panels/settings/primitives/SettingsRow";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { useWorkbench } from "@/state/store";
import { useWorkspace } from "@/hooks/useWorkspace";
import { notifySend } from "@/lib/tauri";

export default function IdentitySection() {
  const data = useProjectSettingsStore((s) => s.data);
  const projectId = useProjectSettingsStore((s) => s.projectId);
  const patch = useProjectSettingsStore((s) => s.patch);
  const flush = useProjectSettingsStore((s) => s.flush);
  const workspaceCount = useWorkbench(
    (s) => s.workspaces.filter((w) => w.projectId === projectId).length,
  );
  const { removeProject } = useWorkspace();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (!data) return null;
  const handleBlur = () => {
    void flush();
  };
  async function handleRemove() {
    if (!projectId || removing) return;
    setRemoving(true);
    try {
      await removeProject(projectId);
      // On success the store closes the panel and this component unmounts — no state reset.
    } catch (err) {
      setRemoving(false);
      setConfirmOpen(false);
      const message = err instanceof Error ? err.message : String(err);
      console.error("remove project failed", err);
      void notifySend("Remove project failed", `${data?.name}: ${message}`, undefined, "error").catch(() => {});
    }
  }

  return (
    <div data-testid="project-identity" className="space-y-5">
      <SettingsGroup title="Identity" description="How this project appears across Maverick.">
        <SettingsRow
          title="Display name"
          description="Shown in the PROJECTS list, breadcrumbs, and Project Settings header."
          control={
            <Input
              data-testid="identity-name"
              defaultValue={data.name}
              onChange={(e) => patch({ name: e.target.value })}
              onBlur={handleBlur}
              className="w-72"
            />
          }
        />
        <SettingsRow
          title="Root path"
          description="The local directory backing this project. Move via your file manager and re-add — don't edit here."
          control={
            <div
              data-testid="identity-root-path"
              className="select-text break-all text-right font-mono text-[12px] text-muted-foreground"
            >
              {data.rootPath}
            </div>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Danger Zone"
        description="Remove this project from Maverick. Your source folder is never deleted."
      >
        <SettingsRow
          title="Remove project"
          description="Removes the project, its workspaces, and their worktrees from Maverick. The original source folder stays on disk."
          control={
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmOpen(true)}
            >
              Remove project
            </Button>
          }
        />
      </SettingsGroup>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Remove "${data.name}"?`}</DialogTitle>
            <DialogDescription>
              {`This removes the project and its ${workspaceCount} workspace${workspaceCount === 1 ? "" : "s"} (and their worktrees) from Maverick. Your source folder stays on disk — only Maverick's worktrees and records are removed.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              data-testid="confirm-remove-project"
              disabled={removing}
              onClick={() => void handleRemove()}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
