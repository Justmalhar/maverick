import { Input } from "@/components/ui/input";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsToggle } from "../primitives/SettingsToggle";
import { useSettings } from "@/lib/stores/settings";

export default function GitSettings() {
  const [remote, setRemote] = useSettings("git.remote", "origin");
  const [template, setTemplate] = useSettings("git.template", "");
  const [autoFetch, setAutoFetch] = useSettings("git.autoFetchMinutes", 5);
  const [gpg, setGpg] = useSettings("git.gpgSign", false);

  return (
    <div data-testid="git-settings" className="space-y-5">
      <SettingsGroup title="Remote">
        <SettingsRow
          title="Default remote"
          description="Used by Push / Pull and 'Auto-fetch'."
          control={
            <Input
              data-testid="git-remote"
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
              className="max-w-sm"
            />
          }
        />
        <SettingsRow
          title="Auto-fetch interval"
          description="Minutes between background `git fetch`. Set to 0 to disable."
          control={
            <Input
              type="number"
              min={0}
              data-testid="git-autofetch"
              value={autoFetch}
              onChange={(e) => setAutoFetch(Number(e.target.value))}
              className="max-w-[120px]"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Commits">
        <SettingsRow
          title="Commit message template"
          description="Prefilled into the message buffer when staging a commit."
          control={
            <textarea
              data-testid="git-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={3}
              className="w-full max-w-lg resize-none rounded-sm border border-border bg-input p-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          }
        />
        <SettingsRow
          title="GPG signing"
          description="Sign every commit with the configured GPG key."
          control={
            <SettingsToggle
              label="GPG signing"
              checked={gpg}
              onCheckedChange={setGpg}
              data-testid="git-gpg"
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}
