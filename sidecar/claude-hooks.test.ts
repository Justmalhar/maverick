import { describe, it, expect, afterEach } from "bun:test";
import { rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildClaudeHooksSettings, writeClaudeHooksFile } from "./claude-hooks";

const dir = join(tmpdir(), "mv-claude-hooks-test");
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("buildClaudeHooksSettings", () => {
  it("wires the Notification http hook with token + workspace header", () => {
    const s = buildClaudeHooksSettings({ port: 51234, token: "secret-abc" }) as any;
    expect(s.env.MAVERICK_WS).toBe("${MAVERICK_WS}"); // placeholder replaced per-file by writer
    for (const ev of ["Notification"]) {
      const hook = s.hooks[ev][0].hooks[0];
      expect(hook.type).toBe("http");
      expect(hook.url).toBe("http://127.0.0.1:51234/agent-hook");
      expect(hook.headers["X-Maverick-Token"]).toBe("secret-abc");
      expect(hook.headers["X-Maverick-Workspace"]).toBe("${MAVERICK_WS}");
      expect(hook.allowedEnvVars).toEqual(["MAVERICK_WS"]);
    }
    expect((s.hooks as any).Stop).toBeUndefined();
    expect((s.hooks as any).StopFailure).toBeUndefined();
  });
});

describe("writeClaudeHooksFile", () => {
  it("writes <workspaceId>.json with the workspace id in env and returns the path", () => {
    const path = writeClaudeHooksFile({ workspaceId: "ws_1", port: 51234, token: "t", dir });
    expect(path).toBe(join(dir, "ws_1.json"));
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.env.MAVERICK_WS).toBe("ws_1");
    expect(parsed.hooks.Notification[0].hooks[0].headers["X-Maverick-Workspace"]).toBe(
      "${MAVERICK_WS}"
    );
  });

  it("overwrites an existing file idempotently", () => {
    const a = writeClaudeHooksFile({ workspaceId: "ws_1", port: 1, token: "t", dir });
    const b = writeClaudeHooksFile({ workspaceId: "ws_1", port: 2, token: "t", dir });
    expect(a).toBe(b);
    expect(JSON.parse(readFileSync(b, "utf8")).hooks.Notification[0].hooks[0].url).toContain(
      ":2/"
    );
  });
});
