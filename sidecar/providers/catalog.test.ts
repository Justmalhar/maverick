import { describe, test, expect } from "bun:test";
import { listProviders, getProvider, getModel, getDefaultModel, estimateCost3Tier } from "./catalog";

const KNOWN_BACKEND_NAMES = ["claude-code", "codex", "gemini", "aider", "opencode", "antigravity", "ollama"];

describe("sidecar providers catalog", () => {
  test("catalog ids exactly match the frontend's KNOWN_BACKEND_NAMES", () => {
    const ids = listProviders().map((p) => p.id);
    expect(new Set(ids)).toEqual(new Set(KNOWN_BACKEND_NAMES));
  });

  test("getProvider / getModel / getDefaultModel resolve claude-code", () => {
    expect(getProvider("claude-code")?.label).toBe("Claude Code");
    expect(getModel("claude-code", "claude-opus-4-8")?.label).toBe("Opus 4.8");
    expect(getDefaultModel("claude-code")?.id).toBe("claude-opus-4-8");
  });

  test("unknown ids resolve to undefined, not throw", () => {
    expect(getProvider("nope")).toBeUndefined();
    expect(getModel("claude-code", "nope")).toBeUndefined();
    expect(getDefaultModel("aider")).toBeUndefined();
  });

  test("estimateCost3Tier matches the frontend formula", () => {
    const cost = estimateCost3Tier("claude-code", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    const model = getDefaultModel("claude-code")!;
    expect(cost).toBeCloseTo(model.pricing!.inputPerMillion);
  });
});
