import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SettingsGroup } from "@/panels/settings/primitives/SettingsGroup";
import { SettingsRow } from "@/panels/settings/primitives/SettingsRow";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";

export default function WorkspacesSection() {
  const data = useProjectSettingsStore((s) => s.data);
  const patch = useProjectSettingsStore((s) => s.patch);
  const flush = useProjectSettingsStore((s) => s.flush);
  const [newFile, setNewFile] = useState("");

  if (!data) return null;
  const blur = () => {
    void flush();
  };
  const addFile = () => {
    const trimmed = newFile.trim();
    if (!trimmed) return;
    const next = [...data.workspaces.filesToCopy, trimmed];
    patch({ workspaces: { ...data.workspaces, filesToCopy: next } });
    setNewFile("");
    void flush();
  };
  const removeFile = (idx: number) => {
    const next = data.workspaces.filesToCopy.filter((_, i) => i !== idx);
    patch({ workspaces: { ...data.workspaces, filesToCopy: next } });
    void flush();
  };

  return (
    <div data-testid="project-workspaces" className="space-y-5">
      <SettingsGroup title="Workspaces" description="How new workspaces are created from this project.">
        <SettingsRow
          title="Branch new workspaces from"
          description="The base branch each new workspace is forked from."
          control={
            <Input
              defaultValue={data.workspaces.branchFrom}
              onChange={(e) => patch({ workspaces: { ...data.workspaces, branchFrom: e.target.value } })}
              onBlur={blur}
              className="w-72 font-mono"
            />
          }
        />
        <SettingsRow
          title="Remote"
          description="Where Maverick pushes, pulls, and opens PRs."
          control={
            <Input
              defaultValue={data.remote}
              onChange={(e) => patch({ remote: e.target.value })}
              onBlur={blur}
              className="w-72 font-mono"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Files to copy" description="Project-relative file paths copied into each new workspace.">
        <ul className="flex flex-col gap-1 py-3">
          {data.workspaces.filesToCopy.map((f, i) => (
            <li
              key={`${f}-${i}`}
              className="flex items-center justify-between rounded bg-muted/40 px-2 py-1 font-mono text-[12px]"
            >
              <span>{f}</span>
              <button
                type="button"
                aria-label={`Remove ${f}`}
                onClick={() => removeFile(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
        <div className="pb-4">
          <Input
            placeholder=".env.local"
            value={newFile}
            onChange={(e) => setNewFile(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addFile();
              }
            }}
            className="w-72 font-mono"
          />
        </div>
      </SettingsGroup>
    </div>
  );
}
