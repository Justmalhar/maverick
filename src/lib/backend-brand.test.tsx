import { describe, it, expect } from "vitest";
import { BACKEND_BRAND, brandFor } from "./backend-brand";
import { getProvider } from "./models/catalog";
import { KNOWN_BACKEND_NAMES } from "./ipc";

describe("backend-brand", () => {
  it("every KnownBackendName has a brand entry", () => {
    for (const id of KNOWN_BACKEND_NAMES) {
      expect(BACKEND_BRAND[id]).toBeDefined();
    }
  });

  it("label is sourced from the providers catalog, not a separate literal", () => {
    for (const id of KNOWN_BACKEND_NAMES) {
      expect(BACKEND_BRAND[id].label).toBe(getProvider(id)!.label);
    }
  });

  it("brandFor resolves a known id and returns undefined for an unknown one", () => {
    expect(brandFor("claude-code")?.label).toBe("Claude Code");
    expect(brandFor("not-a-backend")).toBeUndefined();
  });

  it("every brand entry keeps its Icon, tagline, and installUrl", () => {
    for (const id of KNOWN_BACKEND_NAMES) {
      const brand = BACKEND_BRAND[id];
      expect(brand.Icon).toBeDefined();
      expect(brand.tagline.length).toBeGreaterThan(0);
      expect(brand.installUrl.length).toBeGreaterThan(0);
    }
  });
});
