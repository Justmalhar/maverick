import { describe, it, expect } from "vitest";
import {
  isWindows,
  resolveDefaultShell,
  resolveShell,
  availableShells,
  shellCommandArgs,
} from "./terminal-shell";

const WIN = { platform: "Win32" };
const MAC = { platform: "MacIntel" };

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

describe("availableShells", () => {
  it("offers PowerShell, cmd, and WSL on Windows", () => {
    expect(availableShells(WIN)).toEqual(["powershell", "cmd", "wsl"]);
  });

  it("offers nothing on macOS/Linux", () => {
    expect(availableShells(MAC)).toEqual([]);
  });
});

describe("shellCommandArgs", () => {
  it("runs a command string via PowerShell on Windows", () => {
    expect(shellCommandArgs("bun install", WIN)).toEqual([
      "powershell",
      "-NoProfile",
      "-Command",
      "bun install",
    ]);
  });
  it("runs a command string via /bin/sh on macOS/Linux", () => {
    expect(shellCommandArgs("bun install", MAC)).toEqual(["/bin/sh", "-c", "bun install"]);
  });
});

describe("resolveShell", () => {
  it("resolves PowerShell", () => {
    expect(resolveShell("powershell", WIN)).toEqual({ shell: "powershell.exe", args: ["-NoLogo"] });
  });

  it("resolves cmd", () => {
    expect(resolveShell("cmd", WIN)).toEqual({ shell: "cmd.exe", args: [] });
  });

  it("resolves WSL", () => {
    expect(resolveShell("wsl", WIN)).toEqual({ shell: "wsl.exe", args: [] });
  });

  it("honors an explicit kind regardless of detected platform", () => {
    expect(resolveShell("cmd", MAC)).toEqual({ shell: "cmd.exe", args: [] });
  });

  it("falls back to the platform default for an unknown kind", () => {
    expect(resolveShell("fish", MAC)).toEqual({ shell: "/bin/zsh", args: ["-l"] });
    expect(resolveShell("fish", WIN)).toEqual({ shell: "powershell.exe", args: ["-NoLogo"] });
  });

  it("falls back to the platform default when no kind is given", () => {
    expect(resolveShell(undefined, MAC)).toEqual({ shell: "/bin/zsh", args: ["-l"] });
  });
});
