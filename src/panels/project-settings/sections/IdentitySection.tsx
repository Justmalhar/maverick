import { Input } from "@/components/ui/input";
import { SettingsGroup } from "@/panels/settings/primitives/SettingsGroup";
import { SettingsRow } from "@/panels/settings/primitives/SettingsRow";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";

export default function IdentitySection() {
  const data = useProjectSettingsStore((s) => s.data);
  const patch = useProjectSettingsStore((s) => s.patch);
  const flush = useProjectSettingsStore((s) => s.flush);

  if (!data) return null;
  const handleBlur = () => {
    void flush();
  };

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
          control={<div className="font-mono text-[12px] text-muted-foreground">{data.rootPath}</div>}
        />
      </SettingsGroup>
    </div>
  );
}
