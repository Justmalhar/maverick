import { describe, expect, it } from "vitest";
import { languageForPath, SHIKI_LANGS } from "./languages";

describe("languageForPath", () => {
  it.each([
    ["/a/b.ts", "typescript"],
    ["/a/b.tsx", "tsx"],
    ["/a/b.js", "javascript"],
    ["/a/b.jsx", "jsx"],
    ["/a/b.rs", "rust"],
    ["/a/b.py", "python"],
    ["/a/b.go", "go"],
    ["/a/b.json", "json"],
    ["/a/b.css", "css"],
    ["/a/b.html", "html"],
    ["/a/b.md", "markdown"],
    ["/a/b.yaml", "yaml"],
    ["/a/b.yml", "yaml"],
    ["/a/b.toml", "toml"],
    ["/a/b.sh", "shellscript"],
    ["/a/b.sql", "sql"],
    ["/a/b.swift", "swift"],
    ["/a/Dockerfile", "docker"],
  ])("%s -> %s", (path, lang) => {
    expect(languageForPath(path)).toBe(lang);
  });

  it("unknown extension falls back to plaintext", () => {
    expect(languageForPath("/a/b.xyzzy")).toBe("plaintext");
  });

  it("every mapped language is in SHIKI_LANGS or plaintext", () => {
    expect(SHIKI_LANGS.length).toBeGreaterThan(10);
  });
});
