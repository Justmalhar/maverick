import { describe, test, expect } from "bun:test";
import { PresetLauncher } from "./preset-launcher";
import { ConfigLoader } from "./config-loader";
import { WorktreeManager } from "./worktree-manager";
import { SQLiteStore, defaultMigrationsDir } from "./sqlite-store";
import type { PresetNode, Shell } from "./types";

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
  return new PresetLauncher({ loader, worktree, store: opts?.store });
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

  test("launch returns a layout descriptor (no pre-spawning) with cwd resolved", async () => {
    const launcher = makeLauncher();
    const r = await launcher.launch({
      preset: { name: "x", layout: TERMINAL_LAYOUT },
      projectPath: "/r",
    });
    expect(r.workspaceId).toBe("ws_x");
    // No ptyIds — the frontend spawns terminals via Rust ConPTY from this layout.
    expect(r.layout.type).toBe("terminal");
    // {{workspace_root}} is expanded to the real worktree path.
    if (r.layout.type === "terminal") expect(r.layout.cwd).toBe(r.worktreePath);
  });

  test("launch persists the workspace row and returns the created branch (#2, #4)", async () => {
    const store = makeStore();
    const project = store.projectAdd({ path: "/r" });
    const launcher = makeLauncher({ store });
    const r = await launcher.launch({
      preset: { name: "feat", layout: TERMINAL_LAYOUT },
      projectPath: "/r",
      projectId: project.id,
    });
    // Persisted with the REAL worktree path + branch (no more in-memory-only row
    // with worktreePath:"" that leaked the worktree on close).
    const ws = store.workspaceGet(r.workspaceId);
    expect(ws).not.toBeNull();
    expect(ws?.worktreePath).toBe(r.worktreePath);
    expect(ws?.branch).toBe(r.branch);
    expect(r.branch).toContain("feat-");
  });

  test("launch resolves the base branch via the worktree manager (#5)", async () => {
    const candidates: Array<string | undefined>[] = [];
    const worktree = {
      resolveBaseBranch: async (_p: string, c: Array<string | undefined>) => {
        candidates.push(c);
        return "master";
      },
      create: async () => ({ workspaceId: "ws_r", worktreePath: "/wt/r" }),
    };
    const launcher = new PresetLauncher({
      loader: new ConfigLoader({ read: () => "{}", exists: () => true }),
      worktree: worktree as never,
    });
    await launcher.launch({ preset: { name: "p", layout: { type: "browser" } }, projectPath: "/r", baseBranch: "dev" });
    // The preset/explicit base lead the candidate list, ending in main/master fallbacks.
    expect(candidates[0]).toContain("dev");
    expect(candidates[0]).toContain("master");
  });

  test("launch preserves a top/bottom split in the returned layout", async () => {
    const launcher = makeLauncher();
    const r = await launcher.launch({
      preset: { name: "tb", layout: SPLIT_TOP_BOTTOM },
      projectPath: "/r",
    });
    expect(r.layout.type).toBe("split");
    if (r.layout.type === "split" && "top" in r.layout) {
      expect(r.layout.top.type).toBe("terminal");
      expect(r.layout.bottom.type).toBe("terminal");
      if (r.layout.top.type === "terminal") expect(r.layout.top.cwd).toBe(r.worktreePath);
    }
  });

  test("launch keeps a browser node in the layout (frontend decides placement)", async () => {
    const launcher = makeLauncher();
    const r = await launcher.launch({
      preset: { name: "lr", layout: SPLIT_LEFT_RIGHT },
      projectPath: "/r",
    });
    expect(r.layout.type).toBe("split");
    if (r.layout.type === "split" && "left" in r.layout) {
      expect(r.layout.left.type).toBe("terminal");
      expect(r.layout.right.type).toBe("browser");
    }
  });

  test("launch returns a bare browser node layout unchanged", async () => {
    const launcher = makeLauncher();
    const r = await launcher.launch({
      preset: { name: "b", layout: { type: "browser" } },
      projectPath: "/r",
    });
    expect(r.layout).toEqual({ type: "browser" });
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
