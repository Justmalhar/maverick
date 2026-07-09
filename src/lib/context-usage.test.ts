import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateTokensForMessages,
  estimateCostFromUsage,
  formatTokens,
} from "./context-usage";
import { getDefaultModel } from "./models/catalog";

describe("context-usage helpers", () => {
  it("estimateTokens uses ~4 chars per token and handles empty input", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4)
  });

  it("estimateTokensForMessages sums per-message estimates", () => {
    expect(
      estimateTokensForMessages([{ content: "abcd" }, { content: "abcdefgh" }])
    ).toBe(3); // 1 + 2
  });

  it("estimateCostFromUsage prices each tier at the backend's default model rate", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheCreationTokens: 0 };
    const model = getDefaultModel("claude-code")!;
    const expected = model.pricing!.inputPerMillion + model.pricing!.outputPerMillion + model.pricing!.cachedPerMillion;
    expect(estimateCostFromUsage(usage, "claude-code")).toBeCloseTo(expected);
  });

  it("estimateCostFromUsage prices cache-creation tokens at the input rate", () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 1_000_000 };
    const model = getDefaultModel("claude-code")!;
    expect(estimateCostFromUsage(usage, "claude-code")).toBeCloseTo(model.pricing!.inputPerMillion);
  });

  it("estimateCostFromUsage returns 0 for a backend with no priced default model", () => {
    const usage = { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    expect(estimateCostFromUsage(usage, "aider")).toBe(0);
  });

  it("formatTokens abbreviates thousands and millions", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});
