import { useOSPlatform } from "@/hooks/useOSPlatform";
import { formatKeybinding } from "@/shortcuts/format";

export default function SkillsSettings() {
  const platform = useOSPlatform();
  return (
    <div data-testid="skills-settings" className="space-y-5">
      <div className="rounded-xl border border-border bg-card/30 px-5 py-4 text-xs text-muted-foreground">
        Skills are reusable prompt + tool bundles loaded into every workspace. Drop a
        <code className="mx-1 rounded bg-muted/40 px-1 font-mono">skill.md</code>
        into{" "}
        <code className="rounded bg-muted/40 px-1 font-mono">~/.maverick/skills/</code>{" "}
        and it&apos;ll appear in the preset launcher (<kbd>{formatKeybinding("$mod+Shift+Space", platform)}</kbd>). Per-skill
        toggles and project overrides ship in a later release.
      </div>
    </div>
  );
}
