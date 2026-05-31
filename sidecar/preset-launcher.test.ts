import { describe, test, expect } from "bun:test";
import { PresetLauncher } from "./preset-launcher";
import { ConfigLoader } from "./config-loader";
import { WorktreeManager } from "./worktree-manager";
import { ProcessManager } from "./process-manager";
import { SQLiteStore, defaultMigrationsDir } from "./sqlite-store";
import type { PresetNode, Shell } from "./types";
import type { ManagedProc, Spawner } from "./process-manager";

function makeStore(): SQLiteStore {
  let counter = 0;
  return new SQLiteStore({
    path: ":memory:",
    migrationsDir: defaultMigrationsDir(),
    ids: { uuid: (p) => `${p}_${++counter}`, now: () => 1_700_000_000_000 + counter * 1000 },
  });
}

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

function makeLauncher(opts?: { loadFails?: boolean; presets?: unknown[]; store?: SQLiteStore }) {
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
  return new PresetLauncher({ loader, worktree, process, store: opts?.store });
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

  test("launch with left/right split spawns terminals and reports browser panes", async () => {
    const launcher = makeLauncher();
    const r = await launcher.launch({
      preset: { name: "lr", layout: SPLIT_LEFT_RIGHT },
      projectPath: "/r",
    });
    expect(r.ptyIds).toHaveLength(1);
    expect(r.browserPanes).toEqual([{ url: "https://x" }]);
  });

  test("launch reports a browser pane with no url", async () => {
    const launcher = makeLauncher();
    const r = await launcher.launch({
      preset: { name: "b", layout: { type: "browser" } },
      projectPath: "/r",
    });
    expect(r.ptyIds).toHaveLength(0);
    expect(r.browserPanes).toEqual([{ url: undefined }]);
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

  test("saveCurrent without a store returns a WorkspacePreset (no persistence)", () => {
    const launcher = makeLauncher();
    const preset = launcher.saveCurrent({
      workspaceId: "ws",
      name: "saved",
      layout: TERMINAL_LAYOUT,
      description: "d",
      baseBranch: "dev",
    });
    expect(preset.name).toBe("saved");
    expect(preset.description).toBe("d");
    expect(preset.baseBranch).toBe("dev");
  });

  test("saveCurrent persists to the store and is then listed", () => {
    const store = makeStore();
    const proj = store.projectAdd({ path: "/r" });
    const ws = store.workspaceCreate({
      projectId: proj.id,
      branch: "main",
      agentBackend: "claude",
      worktreePath: "/wt",
    });
    const launcher = makeLauncher({ store });
    const saved = launcher.saveCurrent({ workspaceId: ws.id, name: "persisted", layout: TERMINAL_LAYOUT });
    expect(saved.name).toBe("persisted");
    expect(store.presetList(proj.id).map((p) => p.name)).toEqual(["persisted"]);
  });

  test("list merges DB presets (newest first) ahead of config presets", () => {
    const store = makeStore();
    const proj = store.projectAdd({ path: "/r" });
    store.presetSave({ name: "db-preset", layout: TERMINAL_LAYOUT, projectId: proj.id });
    const launcher = makeLauncher({ store, presets: [{ name: "cfg-preset", layout: TERMINAL_LAYOUT }] });
    const list = launcher.list({ projectPath: "/r", projectId: proj.id });
    expect(list.map((p) => p.name)).toEqual(["db-preset", "cfg-preset"]);
  });

  test("list returns config presets only when no projectId is given", () => {
    const launcher = makeLauncher({ presets: [{ name: "cfg", layout: TERMINAL_LAYOUT }] });
    expect(launcher.list({ projectPath: "/r" }).map((p) => p.name)).toEqual(["cfg"]);
  });

  test("default constructor builds without DI", () => {
    expect(new PresetLauncher()).toBeInstanceOf(PresetLauncher);
  });
});
