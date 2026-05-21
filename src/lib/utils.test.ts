import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges plain strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("dedupes conflicting tailwind classes via twMerge", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("filters out falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("handles arrays and objects from clsx", () => {
    expect(cn(["a", { b: true, c: false }])).toBe("a b");
  });

  it("returns an empty string with no inputs", () => {
    expect(cn()).toBe("");
  });
});
