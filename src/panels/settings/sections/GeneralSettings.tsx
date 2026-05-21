import { Input } from "@/components/ui/input";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsToggle } from "../primitives/SettingsToggle";
import { useSettings } from "@/lib/stores/settings";

export default function GeneralSettings() {
  const [defaultBackend, setDefaultBackend] = useSettings("general.defaultBackend", "claude");
  const [defaultBranch, setDefaultBranch] = useSettings("general.defaultBranch", "origin/main");
  const [namingScheme, setNamingScheme] = useSettings("general.namingScheme", "{branch}");
  const [restore, setRestore] = useSettings("general.restoreSession", true);

  return (
    <div data-testid="general-settings" className="space-y-5">
      <SettingsGroup title="Defaults" description="Applied when a workspace is created without a preset.">
        <SettingsRow
          title="Default backend"
          description="The AI CLI used when no backend is specified in the preset."
          control={
            <Input
              data-testid="general-default-backend"
              value={defaultBackend}
              onChange={(e) => setDefaultBackend(e.target.value)}
              className="max-w-sm"
            />
          }
        />
        <SettingsRow
          title="Default base branch"
          description="New worktrees are forked from this branch."
          control={
            <Input
              data-testid="general-default-branch"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              className="max-w-sm"
            />
          }
        />
        <SettingsRow
          title="Workspace naming scheme"
          description="Tokens: {branch}, {backend}, {date}."
          control={
            <Input
              data-testid="general-naming"
              value={namingScheme}
              onChange={(e) => setNamingScheme(e.target.value)}
              placeholder="{branch} or {backend}-{date}"
              className="max-w-sm"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Startup">
        <SettingsRow
          title="Restore last session on startup"
          description="Re-open the workspaces that were active when you last closed Maverick."
          control={
            <SettingsToggle
              label="Restore last session"
              checked={restore}
              onCheckedChange={setRestore}
              data-testid="general-restore"
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}
