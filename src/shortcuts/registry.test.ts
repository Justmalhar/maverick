import { describe, it, expect } from "vitest";
import { KEYBINDINGS, getKeybinding } from "./registry";

describe("keybinding registry", () => {
  it("has unique ids and labels", () => {
    const ids = new Set(KEYBINDINGS.map((k) => k.id));
    expect(ids.size).toBe(KEYBINDINGS.length);
    for (const k of KEYBINDINGS) {
      expect(k.id).toBeTruthy();
      expect(typeof k.keys).toBe("string");
      expect(k.label).toBeTruthy();
    }
  });

  it("getKeybinding returns a definition or undefined", () => {
    expect(getKeybinding("workspace.next")?.label).toBe("Next workspace");
    expect(getKeybinding("nonexistent")).toBeUndefined();
  });

  it("workspace index jumps 1-9 are registered for discovery in the help/palette", () => {
    for (let i = 1; i <= 9; i++) {
      const def = getKeybinding(`workspace.jump.${i}`);
      expect(def).toBeDefined();
      expect(def?.keys).toBe(`$mod+${i}`);
      expect(def?.display).toBe(`⌘${i}`);
      expect(def?.category).toBe("Workspace");
    }
  });
});
