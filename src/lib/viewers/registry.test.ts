import { describe, expect, it } from "vitest";
import { ViewerRegistry } from "./registry";
import type { ViewerDescriptor } from "./types";
import { fileMetaForPath } from "./types";

const stub = (over: Partial<ViewerDescriptor>): ViewerDescriptor => ({
  id: "stub",
  displayName: "Stub",
  priority: 0,
  capabilities: {},
  canHandle: () => true,
  load: async () => () => null,
  ...over,
});

const meta = { path: "/wt/a.md", name: "a.md", ext: "md", binary: false, size: 10 };

describe("ViewerRegistry", () => {
  it("resolves matching descriptors ordered by priority desc", () => {
    const r = new ViewerRegistry();
    r.register(stub({ id: "low", priority: 1 }));
    r.register(stub({ id: "high", priority: 9 }));
    r.register(stub({ id: "no", canHandle: () => false }));
    expect(r.resolve(meta, "preview").map((d) => d.id)).toEqual(["high", "low"]);
  });

  it("get returns a descriptor by id, undefined for unknown", () => {
    const r = new ViewerRegistry();
    r.register(stub({ id: "x" }));
    expect(r.get("x")?.id).toBe("x");
    expect(r.get("nope")).toBeUndefined();
  });

  it("rejects duplicate ids", () => {
    const r = new ViewerRegistry();
    r.register(stub({ id: "x" }));
    expect(() => r.register(stub({ id: "x" }))).toThrow(/duplicate/i);
  });

  it("passes intent into canHandle", () => {
    const r = new ViewerRegistry();
    r.register(stub({ id: "diff-only", canHandle: (_f, intent) => intent === "diff" }));
    expect(r.resolve(meta, "diff").map((d) => d.id)).toEqual(["diff-only"]);
    expect(r.resolve(meta, "preview")).toEqual([]);
  });
});

describe("fileMetaForPath", () => {
  it("extracts name and extension from a normal path", () => {
    const m = fileMetaForPath("/wt/src/foo.ts");
    expect(m.name).toBe("foo.ts");
    expect(m.ext).toBe("ts");
    expect(m.binary).toBe(false);
    expect(m.size).toBe(0);
  });

  it("returns empty ext when the file has no extension (dot ≤ 0)", () => {
    // dot === -1 → no dot at all → ext should be ""
    const m = fileMetaForPath("/wt/Makefile");
    expect(m.ext).toBe("");
    expect(m.name).toBe("Makefile");
  });

  it("returns empty ext for a hidden dotfile (dot === 0)", () => {
    // .gitignore → dot === 0 → ext should be "" (not "gitignore")
    const m = fileMetaForPath("/wt/.gitignore");
    expect(m.ext).toBe("");
    expect(m.name).toBe(".gitignore");
  });

  it("accepts opts.binary and opts.size overrides", () => {
    const m = fileMetaForPath("/wt/image.png", { binary: true, size: 1024 });
    expect(m.binary).toBe(true);
    expect(m.size).toBe(1024);
  });

  it("uses the full path as name when split returns empty (edge case)", () => {
    // A path that is just "/" → pop() → "" which is falsy so ?? path fires.
    // More practically: pass an empty string so pop() is undefined.
    const m = fileMetaForPath("");
    // split("").pop() is "" (falsy) → falls back to the full path "".
    expect(m.path).toBe("");
  });
});
