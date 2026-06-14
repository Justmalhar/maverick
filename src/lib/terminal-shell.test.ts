import { describe, it, expect } from "vitest";
import { isWindows, resolveDefaultShell } from "./terminal-shell";

describe("isWindows", () => {
  it("detects Windows from userAgent", () => {
    expect(isWindows({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64)" })).toBe(true);
  });

  it("detects Windows from platform", () => {
    expect(isWindows({ userAgent: "", platform: "Win32" })).toBe(true);
  });

  it("returns false for macOS", () => {
    expect(isWindows({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel" })).toBe(
      false
    );
  });

  it("returns false when nav fields are absent", () => {
    expect(isWindows({})).toBe(false);
  });

  it("falls back to global navigator when no arg given", () => {
    // jsdom navigator is not Windows
    expect(typeof isWindows()).toBe("boolean");
  });
});

describe("resolveDefaultShell", () => {
  it("returns PowerShell on Windows", () => {
    expect(resolveDefaultShell({ platform: "Win32" })).toEqual({
      shell: "powershell.exe",
      args: ["-NoLogo"],
    });
  });

  it("returns login zsh on macOS/Linux", () => {
    expect(resolveDefaultShell({ platform: "MacIntel" })).toEqual({
      shell: "/bin/zsh",
      args: ["-l"],
    });
  });
});
