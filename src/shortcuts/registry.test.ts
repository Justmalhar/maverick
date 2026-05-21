import { describe, it, expect } from "vitest";
import { KEYBINDINGS, getKeybinding } from "./registry";

describe("keybinding registry", () => {
  it("has unique ids and keys present", () => {
    const ids = new Set(KEYBINDINGS.map((k) => k.id));
    expect(ids.size).toBe(KEYBINDINGS.length);
    for (const k of KEYBINDINGS) {
      expect(k.id).toBeTruthy();
      expect(k.keys).toBeTruthy();
      expect(k.label).toBeTruthy();
    }
  });

  it("getKeybinding returns a definition or undefined", () => {
    expect(getKeybinding("workspace.next")?.label).toBe("Next workspace");
    expect(getKeybinding("nonexistent")).toBeUndefined();
  });
});
