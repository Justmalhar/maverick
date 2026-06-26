import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateTokensForMessages,
  pricePer1k,
  estimateCost,
  estimateCostFromUsage,
  formatTokens,
} from "./context-usage";

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

  it("pricePer1k matches backend id substrings and defaults to 0", () => {
    expect(pricePer1k("claude-code")).toBeGreaterThan(0);
    expect(pricePer1k("codex")).toBeGreaterThan(0);
    expect(pricePer1k("gemini-2.0")).toBeGreaterThan(0);
    expect(pricePer1k("ollama")).toBe(0);
    expect(pricePer1k("unknown-backend")).toBe(0);
  });

  it("estimateCost scales tokens by the backend price", () => {
    const cost = estimateCost(2000, "claude");
    expect(cost).toBeCloseTo(2 * pricePer1k("claude"));
    expect(estimateCost(1000, "ollama")).toBe(0);
  });

  it("estimateCostFromUsage discounts cache reads instead of full-rating totalTokens", () => {
    const usage = {
      inputTokens: 1000,
      outputTokens: 0,
      cacheReadTokens: 100_000,
      cacheCreationTokens: 0,
    };
    // billable = 1000 + 100000*0.1 = 11000, NOT 101000
    expect(estimateCostFromUsage(usage, "claude")).toBeCloseTo(11 * pricePer1k("claude"));
    // and far below what blended totalTokens pricing would have charged
    expect(estimateCostFromUsage(usage, "claude")).toBeLessThan(estimateCost(101_000, "claude"));
  });

  it("formatTokens abbreviates thousands and millions", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});
