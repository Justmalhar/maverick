import providersJson from "../../../providers.json";

export interface CatalogPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedPerMillion: number;
}

export interface CatalogModel {
  id: string;
  label: string;
  pricing: CatalogPricing | null;
}

export interface CatalogProvider {
  id: string;
  label: string;
  dynamic: boolean;
  defaultModel: string | null;
  models: CatalogModel[];
}

export interface CatalogUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

const DATA = providersJson as { providers: CatalogProvider[] };

export function listProviders(): CatalogProvider[] {
  return DATA.providers;
}

export function getProvider(id: string): CatalogProvider | undefined {
  return DATA.providers.find((p) => p.id === id);
}

export function getModel(providerId: string, modelId: string): CatalogModel | undefined {
  return getProvider(providerId)?.models.find((m) => m.id === modelId);
}

export function getDefaultModel(providerId: string): CatalogModel | undefined {
  const provider = getProvider(providerId);
  if (!provider?.defaultModel) return undefined;
  return provider.models.find((m) => m.id === provider.defaultModel);
}

export function estimateCost3Tier(providerId: string, usage: CatalogUsage): number {
  const model = getDefaultModel(providerId);
  if (!model?.pricing) return 0;
  const { inputPerMillion, outputPerMillion, cachedPerMillion } = model.pricing;
  return (
    (usage.inputTokens * inputPerMillion +
      usage.cacheCreationTokens * inputPerMillion +
      usage.outputTokens * outputPerMillion +
      usage.cacheReadTokens * cachedPerMillion) /
    1_000_000
  );
}
