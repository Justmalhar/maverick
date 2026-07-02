import { homedir, platform } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";

const WS_ENV = "MAVERICK_WS";
const WS_PLACEHOLDER = "${" + WS_ENV + "}";

/** Platform data dir for Maverick-managed Claude hook settings files. */
export function claudeHooksDir(): string {
  const p = platform();
  if (p === "darwin") return join(homedir(), "Library", "Application Support", "maverick", "claude-hooks");
  if (p === "win32") return join(process.env.APPDATA ?? homedir(), "maverick", "claude-hooks");
  return join(homedir(), ".local", "share", "maverick", "claude-hooks");
}

function httpHook(port: number, token: string) {
  return {
    hooks: [
      {
        type: "http",
        url: `http://127.0.0.1:${port}/agent-hook`,
        headers: { "X-Maverick-Token": token, "X-Maverick-Workspace": WS_PLACEHOLDER },
        allowedEnvVars: [WS_ENV],
        timeout: 5,
      },
    ],
  };
}

/**
 * The additional-settings JSON Claude loads via `--settings`. Hooks POST each
 * lifecycle event to the sidecar's loopback receiver; the ${MAVERICK_WS} header
 * is interpolated from the per-file `env` block written by writeClaudeHooksFile.
 */
export function buildClaudeHooksSettings(opts: { port: number; token: string }): object {
  const hook = () => [httpHook(opts.port, opts.token)];
  return {
    hooks: { Notification: hook(), Stop: hook(), StopFailure: hook() },
    env: { [WS_ENV]: WS_PLACEHOLDER },
  };
}

/** Write the per-workspace settings file and return its absolute path. */
export function writeClaudeHooksFile(opts: {
  workspaceId: string;
  port: number;
  token: string;
  dir?: string;
}): string {
  const dir = opts.dir ?? claudeHooksDir();
  mkdirSync(dir, { recursive: true });
  const base = buildClaudeHooksSettings({ port: opts.port, token: opts.token }) as {
    env: Record<string, string>;
  };
  const settings = { ...base, env: { ...base.env, [WS_ENV]: opts.workspaceId } };
  const path = join(dir, `${opts.workspaceId}.json`);
  writeFileSync(path, JSON.stringify(settings, null, 2), "utf8");
  return path;
}
