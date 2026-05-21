export default function SkillsSettings() {
  return (
    <div data-testid="skills-settings" className="space-y-5">
      <div
        className="rounded-xl bg-card/30 px-5 py-4 text-xs text-muted-foreground"
        style={{ border: "1px solid hsl(var(--border))" }}
      >
        Skills are reusable prompt + tool bundles loaded into every workspace. Drop a
        <code className="mx-1 rounded bg-muted/40 px-1 font-mono">skill.md</code>
        into{" "}
        <code className="rounded bg-muted/40 px-1 font-mono">~/.maverick/skills/</code>{" "}
        and it&apos;ll appear in the preset launcher (<kbd>⌘⇧Space</kbd>). Per-skill
        toggles and project overrides ship in a later release.
      </div>
    </div>
  );
}
