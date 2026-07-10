import { useEffect, useState } from "react";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { useSettings } from "@/lib/stores/settings";
import { listOllamaModels } from "@/lib/tauri";
import { listProviders, type CatalogProvider } from "@/lib/models/catalog";
import type { SettingsKey } from "@/lib/ipc";

function settingsKeyFor(providerId: string): SettingsKey {
  return `models.${providerId}.id` as SettingsKey;
}

function StaticProviderRow({ provider }: { provider: CatalogProvider }) {
  // Only rendered for providers with models.length > 0 (see ModelsSettings below),
  // and every such provider in providers.json carries a non-null defaultModel.
  const [model, setModel] = useSettings(settingsKeyFor(provider.id), provider.defaultModel!);
  return (
    <SettingsRow
      title={provider.label}
      description={`Default model used when starting a ${provider.label} workspace.`}
      control={
        <SettingsSelect
          label={`${provider.label} default model`}
          value={model}
          onValueChange={setModel}
          options={provider.models.map((m) => ({ value: m.id, label: m.label }))}
          data-testid={`model-${provider.id}`}
        />
      }
    />
  );
}

function OllamaProviderRow({ provider }: { provider: CatalogProvider }) {
  const [model, setModel] = useSettings(settingsKeyFor(provider.id), "");
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listOllamaModels()
      .then((models) => {
        if (!cancelled) {
          setOptions(models.map((m) => ({ value: m.id, label: m.label })));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOptions([]);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loaded && options.length === 0) {
    return (
      <SettingsRow
        title={provider.label}
        description="No local models detected. Install one with `ollama pull <model>`."
        control={<span data-testid="model-ollama-empty" className="text-xs text-muted-foreground">None found</span>}
      />
    );
  }

  return (
    <SettingsRow
      title={provider.label}
      description={`Default model used when starting an ${provider.label} workspace.`}
      control={
        <SettingsSelect
          label={`${provider.label} default model`}
          value={model}
          onValueChange={setModel}
          options={options}
          data-testid={`model-${provider.id}`}
        />
      }
    />
  );
}

export default function ModelsSettings() {
  const providers = listProviders().filter((p) => p.models.length > 0 || p.dynamic);
  return (
    <div data-testid="models-settings" className="space-y-5">
      <SettingsGroup title="Default models" description="Pick the model each provider should use by default.">
        {providers.map((p) =>
          p.dynamic ? (
            <OllamaProviderRow key={p.id} provider={p} />
          ) : (
            <StaticProviderRow key={p.id} provider={p} />
          ),
        )}
      </SettingsGroup>
    </div>
  );
}
