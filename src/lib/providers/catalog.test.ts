import { describe, it, expect } from "vitest";
import { KNOWN_BACKEND_NAMES } from "@/lib/ipc";
import {
  listProviders,
  getProvider,
  getModel,
  getDefaultModel,
  estimateCost3Tier,
} from "./catalog";

describe("providers catalog", () => {
  it("every KNOWN_BACKEND_NAMES id has exactly one catalog entry, and vice versa", () => {
    const ids = listProviders().map((p) => p.id);
    expect(new Set(ids)).toEqual(new Set(KNOWN_BACKEND_NAMES));
    expect(ids).toHaveLength(KNOWN_BACKEND_NAMES.length);
  });

  it("getProvider resolves a known id and returns undefined for an unknown one", () => {
    expect(getProvider("claude-code")?.label).toBe("Claude Code");
    expect(getProvider("not-a-backend")).toBeUndefined();
  });

  it("getModel resolves a model within its provider and undefined otherwise", () => {
    expect(getModel("claude-code", "claude-opus-4-8")?.label).toBe("Opus 4.8");
    expect(getModel("claude-code", "not-a-model")).toBeUndefined();
    expect(getModel("not-a-backend", "claude-opus-4-8")).toBeUndefined();
  });

  it("getDefaultModel resolves to a model actually present in that provider's models list", () => {
    const provider = getProvider("claude-code")!;
    const model = getDefaultModel("claude-code");
    expect(model).toBeDefined();
    expect(provider.models.some((m) => m.id === model!.id)).toBe(true);
    expect(model!.id).toBe(provider.defaultModel);
  });

  it("getDefaultModel returns undefined for providers with no default model yet", () => {
    expect(getDefaultModel("aider")).toBeUndefined();
    expect(getDefaultModel("ollama")).toBeUndefined();
  });

  it("ollama is marked dynamic with an empty static model list", () => {
    const ollama = getProvider("ollama")!;
    expect(ollama.dynamic).toBe(true);
    expect(ollama.models).toEqual([]);
  });

  it("estimateCost3Tier prices input/output/cache-read at their own rates and cache-creation at the input rate", () => {
    const cost = estimateCost3Tier("claude-code", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    });
    const model = getDefaultModel("claude-code")!;
    const expected =
      model.pricing!.inputPerMillion * 2 + // inputTokens + cacheCreationTokens both at input rate
      model.pricing!.outputPerMillion +
      model.pricing!.cachedPerMillion;
    expect(cost).toBeCloseTo(expected);
  });

  it("estimateCost3Tier returns 0 for a provider with no priced default model", () => {
    expect(
      estimateCost3Tier("aider", { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }),
    ).toBe(0);
  });
});
