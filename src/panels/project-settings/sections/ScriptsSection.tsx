import { Textarea } from "@/components/ui/textarea";
import { SettingsGroup } from "@/panels/settings/primitives/SettingsGroup";
import { SettingsRow } from "@/panels/settings/primitives/SettingsRow";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";

const KINDS = [
  { key: "setup", label: "Setup script", hint: "Runs once when a workspace is created. Use for dependency installs." },
  { key: "run", label: "Run script", hint: "Runs when you click ▶ Run in the Panel. Use for dev servers." },
  { key: "archive", label: "Archive script", hint: "Runs before a workspace is destroyed. 30s soft timeout." },
] as const;

export default function ScriptsSection() {
  const data = useProjectSettingsStore((s) => s.data);
  const patch = useProjectSettingsStore((s) => s.patch);
  const flush = useProjectSettingsStore((s) => s.flush);
  if (!data) return null;

  return (
    <div data-testid="project-scripts" className="space-y-5">
      <SettingsGroup title="Scripts" description="Shell commands keyed off workspace lifecycle events.">
        {KINDS.map((k) => (
          <SettingsRow
            key={k.key}
            title={k.label}
            description={k.hint}
            control={
              <Textarea
                aria-label={k.label}
                data-testid={`scripts-${k.key}`}
                defaultValue={data.scripts[k.key]}
                onChange={(e) => patch({ scripts: { ...data.scripts, [k.key]: e.target.value } })}
                onBlur={() => void flush()}
                className="h-24 w-96 font-mono text-[12px]"
                placeholder={k.key === "setup" ? "bun install" : k.key === "run" ? "bun run dev" : ""}
              />
            }
          />
        ))}
      </SettingsGroup>
    </div>
  );
}
