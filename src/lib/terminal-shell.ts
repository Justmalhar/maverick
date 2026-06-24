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

// The shells a Windows terminal can launch under. PowerShell is the default;
// cmd and WSL are selectable per the Windows build's requirements.
export type ShellKind = "powershell" | "cmd" | "wsl";

const WINDOWS_SHELLS: Record<ShellKind, ShellSpec> = {
  powershell: { shell: "powershell.exe", args: ["-NoLogo"] },
  cmd: { shell: "cmd.exe", args: [] },
  wsl: { shell: "wsl.exe", args: [] },
};

/** The shell new terminals use when the user hasn't picked one. */
export const DEFAULT_SHELL_KIND: ShellKind = "powershell";

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

/**
 * argv that runs a shell command STRING on the host's default shell — for
 * Setup/Run scripts and other one-shot script spawns. Windows has no /bin/sh,
 * so it goes through `cmd.exe /c`; POSIX uses `/bin/sh -c`. Mirrors the sidecar
 * `deps.shellCommandArgs`.
 */
export function shellCommandArgs(
  command: string,
  nav?: { userAgent?: string; platform?: string },
): string[] {
  // Windows: PowerShell -Command. Always present; treats newlines as statement
  // separators (multi-line setup scripts) and aliases cp/ls/mv/rm/cat to
  // cmdlets, so POSIX-style scripts mostly work. POSIX uses /bin/sh -c.
  return isWindows(nav)
    ? ["powershell", "-NoProfile", "-Command", command]
    : ["/bin/sh", "-c", command];
}

/** Shell kinds offered in the picker for this platform — Windows only. */
export function availableShells(nav?: { userAgent?: string; platform?: string }): ShellKind[] {
  return isWindows(nav) ? ["powershell", "cmd", "wsl"] : [];
}

/**
 * Resolve a chosen shell kind to its spec. An explicit, recognised kind always
 * wins (platform detection is best-effort); an unknown or absent kind falls
 * back to the platform default. The picker only offers cmd/WSL on Windows, so a
 * non-Windows host never carries a stale Windows kind unless set deliberately.
 */
export function resolveShell(
  kind?: string,
  nav?: { userAgent?: string; platform?: string },
): ShellSpec {
  if (kind && Object.prototype.hasOwnProperty.call(WINDOWS_SHELLS, kind)) {
    return WINDOWS_SHELLS[kind as ShellKind];
  }
  return resolveDefaultShell(nav);
}
