import { describe, test, expect } from "bun:test";
import { PresetLauncher } from "./preset-launcher";
import { ConfigLoader } from "./config-loader";
import { WorktreeManager } from "./worktree-manager";
import { ProcessManager } from "./process-manager";
import type { PresetNode, Shell } from "./types";
import type { ManagedProc, Spawner } from "./process-manager";

function fakeShell(): Shell {
  return {
    async text() { return ""; },
    async run() { return { stdout: "", stderr: "", exitCode: 0 }; },
  };
}

function fakeProc(): ManagedProc {
  return {
    exitCode: null,
    exited: Promise.resolve(0),
    kill() {},
    stdin: { write() { return Promise.resolve(); } },
  };
}

const TERMINAL_LAYOUT: PresetNode = {
  type: "terminal",
  agent: "claude",
  cwd: "{{workspace_root}}",
  mode: "agent",
  startup: "echo hi",
};

const SPLIT_TOP_BOTTOM: PresetNode = {
  type: "split",
  direction: "v",
  ratio: 0.5,
  top: TERMINAL_LAYOUT,
  bottom: TERMINAL_LAYOUT,
};

const SPLIT_LEFT_RIGHT: PresetNode = {
  type: "split",
  direction: "h",
  ratio: 0.5,
  left: TERMINAL_LAYOUT,
  right: { type: "browser", url: "https://x" },
};

function makeLauncher(opts?: { loadFails?: boolean; presets?: unknown[] }) {
  const loader = new ConfigLoader({
    read: () => {
      if (opts?.loadFails) throw new Error("nope");
      const presets = opts?.presets ?? [];
      return JSON.stringify({
        version: 1,
        backends: { default: "claude", available: [] },
        presets,
      });
    },
    exists: () => !opts?.loadFails,
  });
  const worktree = new WorktreeManager({
    shell: fakeShell(),
    ids: { uuid: () => "ws_x", now: () => 1 },
  });
  const spawner: Spawner = () => fakeProc();
  const process = new ProcessManager({
    spawn: spawner,
    notifier: { write: () => {} },
    ids: { uuid: (p) => `${p}_n`, now: () => 1 },
  });
  return new PresetLauncher({ loader, worktree, process });
}

describe("PresetLauncher", () => {
  test("list returns empty when no projectPath", () => {
    expect(makeLauncher().list({})).toEqual([]);
  });

  test("list returns presets from config", () => {
    const launcher = makeLauncher({
      presets: [{ name: "p", layout: TERMINAL_LAYOUT }],
    });
    expect(launcher.list({ projectPath: "/r" })).toHaveLength(1);
  });

  test("list swallows config errors and returns empty", () => {
    const launcher = makeLauncher({ loadFails: true });
    expect(launcher.list({ projectPath: "/r" })).toEqual([]);
  });

  test("launch with single terminal node spawns one pty", async () => {
    const launcher = makeLauncher();
    const r = await launcher.launch({
      preset: { name: "x", layout: TERMINAL_LAYOUT },
      projectPath: "/r",
    });
    expect(r.workspaceId).toBe("ws_x");
    expect(r.ptyIds).toHaveLength(1);
  });

  test("launch with top/bottom split spawns two ptys", async () => {
    const launcher = makeLauncher();
    const r = await launcher.launch({
      preset: { name: "tb", layout: SPLIT_TOP_BOTTOM },
      projectPath: "/r",
    });
    expect(r.ptyIds).toHaveLength(2);
  });

  test("launch with left/right split skips browser nodes", async () => {
    const launcher = makeLauncher();
    const r = await launcher.launch({
      preset: { name: "lr", layout: SPLIT_LEFT_RIGHT },
      projectPath: "/r",
    });
    expect(r.ptyIds).toHaveLength(1);
  });

  test("launch resolves baseBranch from preset, params, or default", async () => {
    const launcher = makeLauncher();
    const r = await launcher.launch({
      preset: { name: "a", baseBranch: "develop", layout: TERMINAL_LAYOUT },
      projectPath: "/r",
    });
    expect(r.workspaceId).toBe("ws_x");
    const r2 = await launcher.launch({
      preset: { name: "b", layout: TERMINAL_LAYOUT },
      projectPath: "/r",
      baseBranch: "feat",
    });
    expect(r2.workspaceId).toBe("ws_x");
  });

  test("saveCurrent returns a WorkspacePreset", () => {
    const launcher = makeLauncher();
    const preset = launcher.saveCurrent({
      workspaceId: "ws",
      name: "saved",
      layout: TERMINAL_LAYOUT,
      description: "d",
    });
    expect(preset.name).toBe("saved");
    expect(preset.description).toBe("d");
  });

  test("default constructor builds without DI", () => {
    expect(new PresetLauncher()).toBeInstanceOf(PresetLauncher);
  });
});
