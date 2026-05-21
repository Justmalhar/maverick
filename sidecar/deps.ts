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

export const defaultShell: Shell = {
  async text(cmd, cwd) {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    if (proc.exitCode !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(err || `exit ${proc.exitCode}`);
    }
    return out;
  },
  async run(cmd, cwd) {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", stdin: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    return { stdout, stderr, exitCode: proc.exitCode ?? 0 };
  },
};
