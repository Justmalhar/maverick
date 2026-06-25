// Pure helpers for the terminal-first launch flow: assembling the command line
// a workspace types into its shell, and bracketed-pasting a prompt once the
// launched CLI is ready for input. No React, no IPC — unit-testable in isolation.
import type { LaunchSpec } from "./ipc";

export const BRACKETED_PASTE_START = "\x1b[200~";
export const BRACKETED_PASTE_END = "\x1b[201~";
export const CR = "\r";

// Default quiet window after which the CLI is assumed ready to receive a paste.
export const DEFAULT_IDLE_MS = 400;
// Hard cap: paste even if output never goes idle (e.g. a CLI that streams a
// spinner forever) so the prompt is never silently dropped.
export const DEFAULT_CAP_MS = 10_000;

// The shell a workspace's primary leaf is running, which decides how the launch
// command line must be quoted and invoked. "wsl" runs a POSIX shell inside, so
// it maps to "posix" here.
export type LaunchShell = "powershell" | "cmd" | "posix";

/** True when a shell word needs quoting to survive the shell verbatim. */
function needsQuote(word: string): boolean {
  return word === "" || /[^A-Za-z0-9_./:=@%+-]/.test(word);
}

/** POSIX single-quote a shell word (wraps, escaping embedded single quotes). */
export function shellQuote(word: string): string {
  if (!needsQuote(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** PowerShell single-quoted literal (embedded single quotes are doubled). */
function powershellQuote(word: string): string {
  return `'${word.replace(/'/g, "''")}'`;
}

/** cmd.exe double-quoted token (cmd has no real inner-quote escaping). */
function cmdQuote(word: string): string {
  return `"${word}"`;
}

/**
 * The exact bytes to write into the shell to launch the CLI: the command and
 * its args, quoted for `shell` and space-joined, terminated with a carriage
 * return.
 *
 * The shell matters: in PowerShell a quoted command (e.g. an absolute
 * `claude.cmd` path) is a string *expression* and is echoed, not executed —
 * it must be invoked with the call operator `& '...'`. cmd.exe runs a quoted
 * path directly and uses double quotes. POSIX shells single-quote. A bare,
 * unquoted command (`claude`) runs verbatim in all three.
 */
export function buildLaunchCommandLine(spec: LaunchSpec, shell: LaunchShell = "posix"): string {
  const parts = [spec.command, ...spec.args].filter((p): p is string => p !== undefined);
  if (shell === "powershell") {
    const [command, ...args] = parts;
    const head = needsQuote(command) ? `& ${powershellQuote(command)}` : command;
    const tail = args.map((a) => (needsQuote(a) ? powershellQuote(a) : a));
    return [head, ...tail].join(" ") + CR;
  }
  if (shell === "cmd") {
    return parts.map((p) => (needsQuote(p) ? cmdQuote(p) : p)).join(" ") + CR;
  }
  return parts.map(shellQuote).join(" ") + CR;
}

/**
 * Wrap text in bracketed-paste markers + CR so a CLI treats a multi-line prompt
 * as one pasted block (not line-by-line input) and then submits it.
 */
export function wrapBracketedPaste(text: string): string {
  return BRACKETED_PASTE_START + text + BRACKETED_PASTE_END + CR;
}

export interface IdleWatcherOptions {
  idleMs?: number;
  capMs?: number;
  onFire: () => void;
}

/**
 * Fires `onFire` exactly once when the watched stream has been quiet for
 * `idleMs`, or unconditionally after `capMs` from the first push — whichever
 * comes first. `push()` is called on every PTY data chunk. Idempotent: after
 * firing or `cancel()`, further pushes are ignored.
 *
 * Timer-driven (uses setTimeout); tests drive it with fake timers.
 */
export class IdleWatcher {
  private readonly idleMs: number;
  private readonly capMs: number;
  private readonly onFire: () => void;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private fired = false;
  private started = false;

  constructor(opts: IdleWatcherOptions) {
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.capMs = opts.capMs ?? DEFAULT_CAP_MS;
    this.onFire = opts.onFire;
  }

  push(): void {
    if (this.fired) return;
    if (!this.started) {
      this.started = true;
      this.capTimer = setTimeout(() => this.fire(), this.capMs);
    }
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.fire(), this.idleMs);
  }

  private fire(): void {
    if (this.fired) return;
    this.fired = true;
    this.clearTimers();
    this.onFire();
  }

  cancel(): void {
    this.fired = true;
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.capTimer) clearTimeout(this.capTimer);
    this.idleTimer = null;
    this.capTimer = null;
  }
}
