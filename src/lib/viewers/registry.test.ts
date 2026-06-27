import { describe, expect, it } from "vitest";
import { ViewerRegistry } from "./registry";
import type { ViewerDescriptor } from "./types";

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
