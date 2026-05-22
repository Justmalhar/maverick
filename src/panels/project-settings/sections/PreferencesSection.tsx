import { Textarea } from "@/components/ui/textarea";
import { SettingsGroup } from "@/panels/settings/primitives/SettingsGroup";
import { SettingsRow } from "@/panels/settings/primitives/SettingsRow";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";

const PREFS = [
  { key: "review", label: "Review", hint: "Custom instructions for the Review action." },
  { key: "createPr", label: "Create PR", hint: "Custom instructions for the Create PR action." },
  { key: "fixErrors", label: "Fix errors", hint: "Custom instructions for the Fix errors action." },
  { key: "resolveConflicts", label: "Resolve conflicts", hint: "Custom instructions for the Resolve conflicts action." },
  { key: "branchRename", label: "Branch rename", hint: "Custom instructions for branch-name generation." },
  { key: "general", label: "General", hint: "Custom instructions sent at the start of every new chat." },
] as const;

export default function PreferencesSection() {
  const data = useProjectSettingsStore((s) => s.data);
  const patch = useProjectSettingsStore((s) => s.patch);
  const flush = useProjectSettingsStore((s) => s.flush);
  if (!data) return null;

  return (
    <div data-testid="project-preferences" className="space-y-5">
      <SettingsGroup
        title="Agent preferences"
        description="Custom instructions appended to built-in agent actions for this project."
      >
        {PREFS.map((p) => (
          <SettingsRow
            key={p.key}
            title={p.label}
            description={p.hint}
            control={
              <Textarea
                aria-label={p.label}
                data-testid={`preferences-${p.key}`}
                defaultValue={data.preferences[p.key] ?? ""}
                onChange={(e) => patch({ preferences: { ...data.preferences, [p.key]: e.target.value } })}
                onBlur={() => void flush()}
                className="h-20 w-96 text-[12px]"
                placeholder={`Add instructions for ${p.label}…`}
              />
            }
          />
        ))}
      </SettingsGroup>
    </div>
  );
}
