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

/** True when a shell word needs single-quoting to survive the shell verbatim. */
function needsQuote(word: string): boolean {
  return word === "" || /[^A-Za-z0-9_./:=@%+-]/.test(word);
}

/** POSIX single-quote a shell word (wraps, escaping embedded single quotes). */
export function shellQuote(word: string): string {
  if (!needsQuote(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * The exact bytes to write into the shell to launch the CLI: the command and
 * its args, shell-quoted and space-joined, terminated with a carriage return.
 */
export function buildLaunchCommandLine(spec: LaunchSpec): string {
  const parts = [spec.command, ...spec.args].filter((p) => p !== undefined);
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
