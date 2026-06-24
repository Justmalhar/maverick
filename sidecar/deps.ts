import type { IdProvider, Notifier, Shell } from "./types";

export const defaultIds: IdProvider = {
  uuid: (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
  now: () => Date.now(),
};

export const stdoutNotifier: Notifier = {
  write(line: string) {
    process.stdout.write(line + "\n");
  },
};

export function emit(notifier: Notifier, method: string, params: unknown): void {
  notifier.write(JSON.stringify({ jsonrpc: "2.0", method, params }));
}

// Hardened, deterministic environment for every spawned subprocess.
// GIT_TERMINAL_PROMPT/GIT_ASKPASS/SSH_ASKPASS suppress interactive credential
// prompts (which would otherwise hang a headless sidecar forever); LC_ALL=C
// forces stable, parseable English git output regardless of the user's locale.
// GCM_INTERACTIVE=Never keeps Git Credential Manager non-interactive.
// We deliberately do NOT set GCM_PROVIDER: an empty value makes GCM emit
// "warning: a host provider override was used" and breaks provider
// auto-detection, so `git push` (and PR creation) fail with stored creds on
// Windows. Letting GCM auto-detect uses the user's existing credentials.
// CLAUDE.md rule 5: we never read or store keys — a network op that needs
// credentials fails fast and surfaces as a typed auth error upstream.
export const HARDENED_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GIT_OPTIONAL_LOCKS: "0",
  GCM_INTERACTIVE: "Never",
  LC_ALL: "C",
};

// Standard Unix tool locations. A macOS/Linux app launched from Finder/Dock (or
// any non-login context) inherits a minimal PATH that usually omits Homebrew
// (/opt/homebrew/bin) and /usr/local/bin, so spawning `git` — and other CLIs —
// fails with ENOENT even though it exists. Append the standard dirs so command
// resolution succeeds regardless of how the app was launched. Existing entries
// keep their order/priority; only missing dirs are added.
const UNIX_TOOL_DIRS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

/** PATH with the standard Unix tool dirs appended (deduped). Unchanged on Windows. */
export function toolAugmentedPath(
  currentPath: string | undefined = process.env.PATH,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  if (platform === "win32") return currentPath;
  const existing = (currentPath ?? "").split(":").filter(Boolean);
  const seen = new Set<string>();
  return [...existing, ...UNIX_TOOL_DIRS].filter((dir) => !seen.has(dir) && seen.add(dir)).join(":");
}

/**
 * Repair the sidecar's own PATH at boot so Bun's command resolution and every
 * child process can find `git`/CLIs even when the host app was launched from the
 * GUI. Idempotent: re-running only ever re-appends already-present dirs.
 */
export function repairToolPath(): void {
  const augmented = toolAugmentedPath();
  if (augmented !== undefined) process.env.PATH = augmented;
}

/**
 * argv that runs a shell command STRING on the host's default shell. Windows
 * has no `/bin/sh`, so user-authored scripts (setup/run/archive, automation
 * shell steps) go through PowerShell there; POSIX uses `/bin/sh -c`.
 */
export function shellCommandArgs(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  // Windows: PowerShell -Command. Always present; treats newlines as statement
  // separators (multi-line scripts) and aliases cp/ls/mv/rm/cat to cmdlets, so
  // POSIX-style setup/archive scripts mostly work. POSIX uses /bin/sh -c.
  return platform === "win32"
    ? ["powershell", "-NoProfile", "-Command", command]
    : ["/bin/sh", "-c", command];
}

function hardenedEnv(): Record<string, string | undefined> {
  return { ...process.env, ...HARDENED_ENV, PATH: toolAugmentedPath() };
}

export const defaultShell: Shell = {
  async text(cmd, cwd) {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: hardenedEnv() });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    if (proc.exitCode !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(err || `exit ${proc.exitCode}`);
    }
    return out;
  },
  async run(cmd, cwd, stdin) {
    const proc = Bun.spawn(cmd, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: stdin !== undefined ? "pipe" : "ignore",
      env: hardenedEnv(),
    });
    if (stdin !== undefined && proc.stdin) {
      const writer = proc.stdin as { write(s: string): unknown; end(): unknown };
      writer.write(stdin);
      writer.end();
    }
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    return { stdout, stderr, exitCode: proc.exitCode ?? 0 };
  },
};
