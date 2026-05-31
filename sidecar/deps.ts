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
// CLAUDE.md rule 5: we never read or store keys — a network op that needs
// credentials fails fast and surfaces as a typed auth error upstream.
export const HARDENED_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GIT_OPTIONAL_LOCKS: "0",
  GCM_INTERACTIVE: "Never",
  GCM_PROVIDER: "",
  LC_ALL: "C",
};

function hardenedEnv(): Record<string, string | undefined> {
  return { ...process.env, ...HARDENED_ENV };
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
