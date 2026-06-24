import { describe, it, expect } from "vitest";
import { slugify, applyNamingScheme } from "./branch-name";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Fix Login Bug!")).toBe("fix-login-bug");
    expect(slugify("  Add   OAuth  ")).toBe("add-oauth");
  });
  it("falls back to 'workspace' for empty input", () => {
    expect(slugify("!!!")).toBe("workspace");
  });
});

describe("applyNamingScheme", () => {
  it("substitutes {feature-name} from the task title", () => {
    expect(applyNamingScheme("feature/{feature-name}", { featureName: "Fix login bug" })).toBe(
      "feature/fix-login-bug",
    );
  });
  it("treats a token-less scheme as a prefix and appends the slug", () => {
    expect(applyNamingScheme("feature/", { featureName: "Fix login" })).toBe("feature/fix-login");
    expect(applyNamingScheme("feature", { featureName: "Fix login" })).toBe("feature/fix-login");
  });
  it("substitutes {backend} and {date} tokens", () => {
    expect(applyNamingScheme("{backend}/{feature-name}", { featureName: "x", backend: "claude-code" })).toBe(
      "claude-code/x",
    );
    expect(applyNamingScheme("{date}/{feature-name}", { featureName: "x", date: "2026-06-24" })).toBe(
      "2026-06-24/x",
    );
  });
  it("empty scheme yields just the slug", () => {
    expect(applyNamingScheme("", { featureName: "Fix login" })).toBe("fix-login");
  });
});
