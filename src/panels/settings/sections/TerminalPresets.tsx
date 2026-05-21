import { Input } from "@/components/ui/input";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { useSettings } from "@/lib/stores/settings";
import type { SettingsKey } from "@/lib/ipc";

interface ProviderPreset {
  provider: "claude" | "codex" | "gemini" | "pi";
  label: string;
  key: SettingsKey;
  defaultCommand: string;
}

const PROVIDERS: ProviderPreset[] = [
  { provider: "claude", label: "Claude", key: "terminal.claude.command", defaultCommand: "claude --continue" },
  { provider: "codex", label: "Codex", key: "terminal.codex.command", defaultCommand: "codex" },
  { provider: "gemini", label: "Gemini", key: "terminal.gemini.command", defaultCommand: "gemini" },
  { provider: "pi", label: "Pi", key: "terminal.pi.command", defaultCommand: "pi" },
];

function ProviderCommandRow({ p }: { p: ProviderPreset }) {
  const [command, setCommand] = useSettings(p.key, p.defaultCommand);
  return (
    <SettingsRow
      title={p.label}
      description={`Command Maverick runs when launching a ${p.label} workspace from the preset launcher.`}
      control={
        <Input
          data-testid={`terminal-${p.provider}`}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={p.defaultCommand}
          className="w-72 font-mono"
        />
      }
    />
  );
}

export default function TerminalPresets() {
  return (
    <div data-testid="terminal-presets" className="space-y-5">
      <SettingsGroup
        title="Launch commands"
        description="One per provider. Tokens like {branch} expand at launch time."
      >
        {PROVIDERS.map((p) => (
          <ProviderCommandRow key={p.provider} p={p} />
        ))}
      </SettingsGroup>
    </div>
  );
}
