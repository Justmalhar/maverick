import { describe, it, expect } from "vitest";
import { formatKeybinding } from "./format";

describe("formatKeybinding", () => {
  it("glues glyphs on macOS", () => {
    expect(formatKeybinding("$mod+Shift+k", "macos")).toBe("⌘⇧K");
    expect(formatKeybinding("$mod+d", "macos")).toBe("⌘D");
    expect(formatKeybinding("$mod+Alt+ArrowLeft", "macos")).toBe("⌘⌥←");
  });

  it("uses Ctrl and + separators on Windows (no Command key)", () => {
    expect(formatKeybinding("$mod+Shift+k", "windows")).toBe("Ctrl+Shift+K");
    expect(formatKeybinding("$mod+d", "windows")).toBe("Ctrl+D");
    expect(formatKeybinding("$mod+Alt+ArrowLeft", "windows")).toBe("Ctrl+Alt+←");
  });

  it("never emits the Command glyph on Windows or Linux", () => {
    for (const keys of ["$mod+Shift+k", "$mod+,", "$mod+Shift+Space", "$mod+Alt+ArrowDown"]) {
      expect(formatKeybinding(keys, "windows")).not.toContain("⌘");
      expect(formatKeybinding(keys, "windows")).not.toContain("⌥");
      expect(formatKeybinding(keys, "linux")).not.toContain("⌘");
    }
  });

  it("maps Meta to Win on Windows and ⌘ on macOS", () => {
    expect(formatKeybinding("Meta+s", "windows")).toBe("Win+S");
    expect(formatKeybinding("Meta+s", "macos")).toBe("⌘S");
  });

  it("renders Space and punctuation", () => {
    expect(formatKeybinding("$mod+Shift+Space", "windows")).toBe("Ctrl+Shift+Space");
    expect(formatKeybinding("$mod+,", "windows")).toBe("Ctrl+,");
    expect(formatKeybinding("$mod+Shift+Space", "macos")).toBe("⌘⇧Space");
  });

  it("renders physical-code symbol bindings as their unshifted glyph", () => {
    expect(formatKeybinding("$mod+Shift+Comma", "windows")).toBe("Ctrl+Shift+,");
    expect(formatKeybinding("$mod+Shift+Period", "windows")).toBe("Ctrl+Shift+.");
    expect(formatKeybinding("$mod+Shift+Slash", "windows")).toBe("Ctrl+Shift+/");
    expect(formatKeybinding("$mod+Shift+Slash", "macos")).toBe("⌘⇧/");
  });

  it("keeps chord sequences space-separated", () => {
    expect(formatKeybinding("] c", "windows")).toBe("] C");
    expect(formatKeybinding("[ c", "macos")).toBe("[ C");
  });

  it("returns empty string for empty input", () => {
    expect(formatKeybinding("", "windows")).toBe("");
  });
});
