import { Input } from "@/components/ui/input";
import { SettingsGroup } from "@/panels/settings/primitives/SettingsGroup";
import { SettingsRow } from "@/panels/settings/primitives/SettingsRow";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";

const TOKENS = ["${WORKSPACE_NAME}", "${WORKSPACE_PORT}", "${WORKSPACE_PATH}"];

export default function PreviewSection() {
  const data = useProjectSettingsStore((s) => s.data);
  const patch = useProjectSettingsStore((s) => s.patch);
  const flush = useProjectSettingsStore((s) => s.flush);
  if (!data) return null;

  return (
    <div data-testid="project-preview" className="space-y-5">
      <SettingsGroup title="Preview" description="Overrides the Panel's Open preview button. Leave blank to hide it.">
        <SettingsRow
          title="Preview URL"
          description="Supports env tokens substituted per workspace."
          control={
            <Input
              defaultValue={data.previewUrl}
              onChange={(e) => patch({ previewUrl: e.target.value })}
              onBlur={() => void flush()}
              placeholder="http://localhost:${WORKSPACE_PORT}"
              className="w-96 font-mono"
            />
          }
        />
        <p className="pb-4 text-[11px] text-muted-foreground">
          Tokens:{" "}
          {TOKENS.map((t) => (
            <code key={t} className="mx-1 rounded bg-muted px-1 py-0.5">
              {t}
            </code>
          ))}
        </p>
      </SettingsGroup>
    </div>
  );
}
