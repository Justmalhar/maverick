import { describe, it, expect } from "vitest";
import { SETTINGS_DEFAULTS } from "./settings-defaults";
import { getDefaultModel } from "@/lib/models/catalog";

describe("SETTINGS_DEFAULTS models.*.id keys", () => {
  it("has exactly the four selectable-model provider keys, no 'pi'", () => {
    const modelKeys = Object.keys(SETTINGS_DEFAULTS).filter((k) => k.startsWith("models."));
    expect(new Set(modelKeys)).toEqual(
      new Set(["models.claude-code.id", "models.codex.id", "models.gemini.id", "models.ollama.id"]),
    );
  });

  it("claude-code/codex/gemini defaults match the catalog's default model id", () => {
    expect(SETTINGS_DEFAULTS["models.claude-code.id"]).toBe(getDefaultModel("claude-code")!.id);
    expect(SETTINGS_DEFAULTS["models.codex.id"]).toBe(getDefaultModel("codex")!.id);
    expect(SETTINGS_DEFAULTS["models.gemini.id"]).toBe(getDefaultModel("gemini")!.id);
  });

  it("ollama has no static default (its models are fetched live)", () => {
    expect(SETTINGS_DEFAULTS["models.ollama.id"]).toBe("");
  });
});
