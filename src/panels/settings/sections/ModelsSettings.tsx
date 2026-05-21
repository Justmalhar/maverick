import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { useSettings } from "@/lib/stores/settings";
import type { SettingsKey } from "@/lib/ipc";

interface ProviderModels {
  provider: "claude" | "codex" | "gemini" | "pi";
  label: string;
  key: SettingsKey;
  defaultModel: string;
  models: { value: string; label: string }[];
}

const PROVIDERS: ProviderModels[] = [
  {
    provider: "claude",
    label: "Claude",
    key: "models.claude.id",
    defaultModel: "claude-opus-4-7",
    models: [
      { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  {
    provider: "codex",
    label: "Codex",
    key: "models.codex.id",
    defaultModel: "gpt-5",
    models: [
      { value: "gpt-5", label: "GPT-5" },
      { value: "gpt-5-mini", label: "GPT-5 Mini" },
      { value: "o4", label: "o4" },
    ],
  },
  {
    provider: "gemini",
    label: "Gemini",
    key: "models.gemini.id",
    defaultModel: "gemini-2.5-pro",
    models: [
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
  },
  {
    provider: "pi",
    label: "Pi",
    key: "models.pi.id",
    defaultModel: "pi-1",
    models: [{ value: "pi-1", label: "Pi 1" }],
  },
];

function ProviderRow({ p }: { p: ProviderModels }) {
  const [model, setModel] = useSettings(p.key, p.defaultModel);
  return (
    <SettingsRow
      title={p.label}
      description={`Default model used when starting a ${p.label} workspace.`}
      control={
        <SettingsSelect
          label={`${p.label} default model`}
          value={model}
          onValueChange={setModel}
          options={p.models}
          data-testid={`model-${p.provider}`}
        />
      }
    />
  );
}

export default function ModelsSettings() {
  return (
    <div data-testid="models-settings" className="space-y-5">
      <SettingsGroup title="Default models" description="Pick the model each provider should use by default.">
        {PROVIDERS.map((p) => (
          <ProviderRow key={p.provider} p={p} />
        ))}
      </SettingsGroup>
    </div>
  );
}
