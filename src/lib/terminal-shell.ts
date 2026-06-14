// Platform-aware default shell for terminal-first workspaces. The terminal is
// Maverick's only workspace surface now, so this default is load-bearing.
//
// Resolution is best-effort from the renderer (we can't stat files or read
// $SHELL here): macOS/Linux get a login zsh; Windows gets PowerShell. The Tauri
// OS plugin would be more authoritative but is async and adds a dependency —
// userAgent sniffing is sufficient for picking a sane default, and the shell is
// overridable per workspace upstream if needed.

export interface ShellSpec {
  shell: string;
  args: string[];
}

const MACOS_LINUX: ShellSpec = { shell: "/bin/zsh", args: ["-l"] };
const WINDOWS: ShellSpec = { shell: "powershell.exe", args: ["-NoLogo"] };

/** True when the host looks like Windows, from a navigator-ish object. */
export function isWindows(nav?: { userAgent?: string; platform?: string }): boolean {
  const n = nav ?? (typeof navigator !== "undefined" ? navigator : undefined);
  if (!n) return false;
  const ua = (n.userAgent ?? "").toLowerCase();
  const platform = ((n as { platform?: string }).platform ?? "").toLowerCase();
  return ua.includes("windows") || platform.startsWith("win");
}

/** The default shell + args for a new terminal leaf on this platform. */
export function resolveDefaultShell(nav?: { userAgent?: string; platform?: string }): ShellSpec {
  return isWindows(nav) ? WINDOWS : MACOS_LINUX;
}
