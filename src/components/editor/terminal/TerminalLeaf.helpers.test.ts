import { describe, it, expect, beforeEach } from "vitest";
import { primaryAgentPtyId, getLeafPtyId, __testing__ } from "./leaf-registry";

beforeEach(() => {
  __testing__.leafPtyCache.clear();
});

describe("primaryAgentPtyId", () => {
  it("resolves the primary leaf's live PTY id", () => {
    __testing__.leafPtyCache.set("w1-1", "pty-w1-1");
    __testing__.leafPtyCache.set("w1-2", "pty-w1-2");
    expect(primaryAgentPtyId("w1")).toBe("pty-w1-1");
  });

  it("returns undefined when the primary leaf has not spawned", () => {
    __testing__.leafPtyCache.set("w1-2", "pty-w1-2");
    expect(primaryAgentPtyId("w1")).toBeUndefined();
  });

  it("getLeafPtyId reads an arbitrary leaf id", () => {
    __testing__.leafPtyCache.set("w1-2", "pty-w1-2");
    expect(getLeafPtyId("w1-2")).toBe("pty-w1-2");
    expect(getLeafPtyId("nope")).toBeUndefined();
  });
});
