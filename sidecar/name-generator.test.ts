import { describe, test, expect } from "bun:test";
import { generateWorkspaceName, slugify, titleize } from "./name-generator";

describe("slugify", () => {
  test("lowercases and dashes whitespace", () => {
    expect(slugify("My Project")).toBe("my-project");
  });

  test("strips invalid characters and collapses dashes", () => {
    expect(slugify("a__b!!--c")).toBe("ab-c");
  });

  test("trims leading/trailing dashes", () => {
    expect(slugify("-x-")).toBe("x");
  });

  test("falls back when nothing survives", () => {
    expect(slugify("!!!")).toBe("workspace");
  });
});

describe("titleize", () => {
  test("capitalizes each dash-separated part", () => {
    expect(titleize("goose-2")).toBe("Goose 2");
  });

  test("single word", () => {
    expect(titleize("viper")).toBe("Viper");
  });
});

describe("generateWorkspaceName", () => {
  test("returns a callsign not in the taken set", () => {
    const name = generateWorkspaceName(["viper", "goose"], { random: () => 0 });
    expect(name.length).toBeGreaterThan(0);
    expect(["viper", "goose"]).not.toContain(name);
  });

  test("is deterministic for a fixed RNG", () => {
    const a = generateWorkspaceName([], { random: () => 0.5 });
    const b = generateWorkspaceName([], { random: () => 0.5 });
    expect(a).toBe(b);
  });

  test("matching is case-insensitive", () => {
    const first = generateWorkspaceName([], { random: () => 0 });
    const next = generateWorkspaceName([first.toUpperCase()], { random: () => 0 });
    expect(next).not.toBe(first);
  });

  test("suffixes with -2 when the whole pool is taken", () => {
    // Exhaust the pool by taking everything un-suffixed.
    const taken: string[] = [];
    for (let i = 0; i < 200; i++) {
      const n = generateWorkspaceName(taken, { random: () => 0 });
      if (!n.includes("-")) taken.push(n);
      else break;
    }
    const suffixed = generateWorkspaceName(taken, { random: () => 0 });
    expect(suffixed).toMatch(/-2$/);
  });

  test("keeps escalating suffixes when -2 names are taken too", () => {
    const taken: string[] = [];
    for (let i = 0; i < 400; i++) {
      const n = generateWorkspaceName(taken, { random: () => 0 });
      taken.push(n);
      if (n.endsWith("-2")) continue;
    }
    const next = generateWorkspaceName(taken, { random: () => 0 });
    expect(taken).not.toContain(next);
  });

  test("uses Math.random by default", () => {
    const name = generateWorkspaceName([]);
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });
});
