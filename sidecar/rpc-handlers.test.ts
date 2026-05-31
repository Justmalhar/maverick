import { describe, test, it, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { RpcHandlers } from "./rpc-handlers";
import { SQLiteStore, defaultMigrationsDir } from "./sqlite-store";
import { ProcessManager } from "./process-manager";
import { WorktreeManager } from "./worktree-manager";
import { ConfigLoader } from "./config-loader";
import { SkillsEngine } from "./skills-engine";
import { DiffReader } from "./diff-reader";
import { GitModule } from "./git-module";
import { PresetLauncher } from "./preset-launcher";
import { KanbanStore } from "./kanban-store";
import { AutomationRunner } from "./automation-runner";
import { MCPManager } from "./mcp-manager";
import { NotificationService } from "./notification-service";
import { ContextTracker } from "./context-tracker";
import { AttachmentStore } from "./attachment-store";
import { FileTree } from "./file-tree";
import { Caffeinate } from "./caffeinate";
import { InstructionsResolver } from "./instructions-resolver";
import type { KanbanTask, Shell } from "./types";
import type { ManagedProc, Spawner } from "./process-manager";

function fakeShell(steps: Array<{ stdout?: string; exitCode?: number; stderr?: string }> = []): {
  shell: Shell;
  calls: string[][];
} {
  const calls: string[][] = [];
  let i = 0;
  return {
    calls,
    shell: {
      async text(cmd) {
        calls.push(cmd);
        return steps[i++]?.stdout ?? "";
      },
      async run(cmd) {
        calls.push(cmd);
        const s = steps[i++] ?? {};
        return { stdout: s.stdout ?? "", stderr: s.stderr ?? "", exitCode: s.exitCode ?? 0 };
      },
    },
  };
}

function fakeProc(): ManagedProc {
  return {
    exitCode: null,
    exited: new Promise<number>(() => {}),
    stdin: { write() { return Promise.resolve(); } },
    kill() {},
  };
}

function buildHandlers(shellSteps: Array<{ stdout?: string; exitCode?: number; stderr?: string }> = []) {
  const ids = (() => {
    let n = 0;
    return { uuid: (p: string) => `${p}_${++n}`, now: () => 1_700_000_000_000 };
  })();
  const { shell } = fakeShell(shellSteps);
  const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir(), ids });
  const proc = new ProcessManager({
    spawn: (() => fakeProc()) as Spawner,
    notifier: { write: () => {} },
    ids,
  });
  const worktree = new WorktreeManager({ shell, ids });
  const config = new ConfigLoader({
    read: () =>
      JSON.stringify({
        version: 1,
        backends: { default: "claude", available: [{ name: "claude", command: "claude", args: [] }] },
        skills: [{ name: "review", description: "d", prompt: "p {{x}}" }],
        presets: [{ name: "preset", layout: { type: "terminal", agent: "claude", cwd: "{{workspace_root}}", mode: "agent" } }],
        automations: [{ name: "auto", trigger: "manual", steps: [{ type: "shell", command: "echo hi" }] }],
        mcps: [{ name: "fs", command: "mcp-fs", args: [] }],
      }),
    exists: () => true,
  });
  const skills = new SkillsEngine({ loader: config });
  const diff = new DiffReader({ shell });
  const git = new GitModule({ shell });
  const presets = new PresetLauncher({ loader: config, worktree, process: proc });
  const kanban = new KanbanStore(store, { ids });
  const automations = new AutomationRunner({ loader: config, shell, git, skills });
  const mcp = new MCPManager({ spawn: (() => fakeProc()) as Spawner, loader: config, projectPath: "/r" });
  const notifications = new NotificationService({ notifier: { write: () => {} } });
  const context = new ContextTracker(store, { ids });
  const attachments = new AttachmentStore({
    writeFile: () => {},
    mkdir: () => {},
    ids,
  });
  const fileTree = new FileTree({
    shell,
    readdir() { return []; },
    stat() { return { isDirectory: false }; },
  });
  return new RpcHandlers({
    store, process: proc, worktree, config, skills, diff, git,
    presets, kanban, automations, mcp, notifications, context, attachments, fileTree,
  });
}

function makeWithTempProject() {
  const dir = mkdtempSync(join(tmpdir(), "mvk-rpc-"));
  const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir() });
  const project = store.projectAdd({ path: dir, name: "tmp" });
  const notifications: Array<{ method: string; params: unknown }> = [];
  const notifier = {
    write(line: string) {
      try {
        const msg = JSON.parse(line) as { method?: string; params?: unknown };
        if (msg.method) notifications.push({ method: msg.method, params: msg.params });
      } catch {
        /* ignore */
      }
    },
  };
  const handlers = new RpcHandlers({ store, notifier });
  return { handlers, dir, projectId: project.id, store, notifications };
}

describe("RpcHandlers", () => {
  let h: RpcHandlers;

  beforeEach(() => {
    h = buildHandlers([
      {}, // worktree create
      {}, // diff get
      {}, // git push, etc as needed
    ]);
  });

  test("project.add and project.list round-trip", async () => {
    const added = (await h.dispatch("project.add", { path: "/tmp/a" })) as { id: string };
    const list = (await h.dispatch("project.list", {})) as Array<{ id: string }>;
    expect(list.find((p) => p.id === added.id)).toBeDefined();
  });

  test("workspace.create + list + destroy", async () => {
    const proj = (await h.dispatch("project.add", { path: "/tmp/ws" })) as { id: string };
    const ws = (await h.dispatch("workspace.create", {
      projectId: proj.id,
      projectPath: "/tmp/ws",
      branch: "feat",
      backend: "claude",
    })) as { id: string };
    const list = (await h.dispatch("workspace.list", { projectId: proj.id })) as unknown[];
    expect(list).toHaveLength(1);
    await h.dispatch("workspace.destroy", { workspaceId: ws.id });
    const empty = (await h.dispatch("workspace.list", { projectId: proj.id })) as unknown[];
    expect(empty).toHaveLength(0);
  });

  test("workspace.create accepts baseBranch: null (Rust Option::None serializes to null)", async () => {
    const proj = (await h.dispatch("project.add", { path: "/tmp/ws-null" })) as { id: string };
    // Mirrors the real Rust→sidecar payload: omitted optionals arrive as JSON null.
    const ws = (await h.dispatch("workspace.create", {
      projectId: proj.id,
      projectPath: "/tmp/ws-null",
      branch: "feat",
      backend: "claude",
      baseBranch: null,
    })) as { id: string };
    expect(ws.id).toBeDefined();
    // workspace.list with a null projectId must not throw either.
    const all = (await h.dispatch("workspace.list", { projectId: null })) as unknown[];
    expect(Array.isArray(all)).toBe(true);
  });

  test("message.append tolerates toolCallsJson: null", async () => {
    const proj = (await h.dispatch("project.add", { path: "/tmp/msg-null" })) as { id: string };
    const ws = (await h.dispatch("workspace.create", {
      projectId: proj.id,
      projectPath: "/tmp/msg-null",
      branch: "main",
      backend: "claude",
      baseBranch: null,
    })) as { sessionId: string };
    const r = (await h.dispatch("messages.append", {
      sessionId: ws.sessionId,
      role: "user",
      content: "hi",
      toolCallsJson: null,
    })) as { id: string };
    expect(r.id).toBeDefined();
  });

  test("pty.spawn/write/resize/kill", async () => {
    const { ptyId } = (await h.dispatch("pty.spawn", {
      workspaceId: "ws",
      command: "echo",
      args: ["hi"],
    })) as { ptyId: string };
    await h.dispatch("pty.write", { ptyId, data: "x" });
    await h.dispatch("pty.resize", { ptyId, cols: 80, rows: 24 });
    await h.dispatch("pty.kill", { ptyId });
    expect(h.process.has(ptyId)).toBe(false);
  });

  test("pty.spawn defaults cwd to the workspace worktree path", async () => {
    const spawnCalls: Array<{ cmd: string[]; cwd?: string }> = [];
    const ids = (() => {
      let n = 0;
      return { uuid: (p: string) => `${p}_${++n}`, now: () => 1_700_000_000_000 };
    })();
    const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir(), ids });
    const proc = new ProcessManager({
      spawn: ((cmd, opts) => {
        spawnCalls.push({ cmd, cwd: opts.cwd });
        return fakeProc();
      }) as Spawner,
      notifier: { write: () => {} },
      ids,
    });
    const handlers = new RpcHandlers({ store, process: proc });
    const proj = (await handlers.dispatch("project.add", { path: "/tmp/wt-cwd" })) as { id: string };
    store.workspaceCreate({
      id: "ws-cwd",
      projectId: proj.id,
      branch: "main",
      agentBackend: "claude",
      worktreePath: "/tmp/wt-cwd/.maverick/worktrees/ws-cwd",
    });

    await handlers.dispatch("pty.spawn", {
      workspaceId: "ws-cwd",
      command: "/bin/zsh",
      args: ["-l"],
    });
    expect(spawnCalls[0].cwd).toBe("/tmp/wt-cwd/.maverick/worktrees/ws-cwd");

    await handlers.dispatch("pty.spawn", {
      workspaceId: "ws-cwd",
      command: "/bin/zsh",
      args: ["-l"],
      cwd: "/explicit/cwd",
    });
    expect(spawnCalls[1].cwd).toBe("/explicit/cwd");
  });

  test("config.load and skills.list/run", async () => {
    const cfg = (await h.dispatch("config.load", { projectPath: "/r" })) as { version: number };
    expect(cfg.version).toBe(1);
    const skills = (await h.dispatch("skills.list", { projectPath: "/r" })) as unknown[];
    expect(skills).toHaveLength(1);
    const r = (await h.dispatch("skills.run", {
      projectPath: "/r",
      skillName: "review",
      vars: { x: "1" },
    })) as { prompt: string };
    expect(r.prompt).toBe("p 1");
  });

  test("messages.append/list", async () => {
    const proj = (await h.dispatch("project.add", { path: "/m" })) as { id: string };
    const ws = (await h.dispatch("workspace.create", {
      projectId: proj.id,
      projectPath: "/m",
      branch: "main",
      backend: "claude",
    })) as { sessionId: string };
    await h.dispatch("messages.append", { sessionId: ws.sessionId, role: "user", content: "hi" });
    const list = (await h.dispatch("messages.list", { sessionId: ws.sessionId })) as unknown[];
    expect(list).toHaveLength(1);
  });

  test("diff.get/stage_hunk/unstage_hunk", async () => {
    await h.dispatch("diff.get", { worktreePath: "/wt" });
    await h.dispatch("diff.stage_hunk", { worktreePath: "/wt", patch: "x" });
    await h.dispatch("diff.unstage_hunk", { worktreePath: "/wt", patch: "x" });
  });

  test("git.log/stash_list/commit", async () => {
    await h.dispatch("git.log", { worktreePath: "/wt" });
    await h.dispatch("git.stash_list", { worktreePath: "/wt" });
    await h.dispatch("git.commit", { worktreePath: "/wt", message: "m" });
  });

  test("git.branches dispatches to git module", async () => {
    const result = await h.dispatch("git.branches", { projectPath: "/tmp/b" });
    expect(Array.isArray(result)).toBe(true);
  });

  test("git.diffStat dispatches to git module", async () => {
    const result = await h.dispatch("git.diffStat", { worktreePath: "/wt" }) as { added: number; removed: number };
    expect(result).toHaveProperty("added");
    expect(result).toHaveProperty("removed");
  });

  test("git.branch_list dispatches and returns rich branches", async () => {
    const handlers = buildHandlers([
      { stdout: "*\trefs/heads/main\torigin/main\tahead 1, behind 0" },
    ]);
    const result = (await handlers.dispatch("git.branch_list", { worktreePath: "/wt" })) as Array<{
      name: string;
      isCurrent: boolean;
    }>;
    expect(result[0]).toMatchObject({ name: "main", isCurrent: true });
  });

  test("git.checkout routes the {branch} param to checkoutBranch", async () => {
    const result = await h.dispatch("git.checkout", { worktreePath: "/wt", branch: "feat" });
    expect(result).toEqual({ ok: true });
  });

  test("git.blame dispatches with filePath", async () => {
    const handlers = buildHandlers([
      { stdout: "abc1234 1 1 1\nauthor A\nauthor-time 1\n\tcode" },
    ]);
    const result = (await handlers.dispatch("git.blame", {
      worktreePath: "/wt",
      filePath: "a.ts",
    })) as Array<{ sha: string }>;
    expect(result[0].sha).toBe("abc1234");
  });

  test("git.cherry_pick dispatches with sha", async () => {
    const result = await h.dispatch("git.cherry_pick", { worktreePath: "/wt", sha: "abc" });
    expect(result).toEqual({ ok: true });
  });

  test("git.stash_apply/pop/drop dispatch with numeric index", async () => {
    expect(await h.dispatch("git.stash_apply", { worktreePath: "/wt", index: 0 })).toEqual({ ok: true });
    expect(await h.dispatch("git.stash_pop", { worktreePath: "/wt", index: 1 })).toEqual({ ok: true });
    expect(await h.dispatch("git.stash_drop", { worktreePath: "/wt", index: 2 })).toEqual({ ok: true });
  });

  test("git.conflicts returns [] for a clean tree", async () => {
    const result = await h.dispatch("git.conflicts", { worktreePath: "/wt" });
    expect(result).toEqual([]);
  });

  test("git.resolve_conflict dispatches with full param shape", async () => {
    const result = await h.dispatch("git.resolve_conflict", {
      worktreePath: "/wt",
      filePath: "f.ts",
      hunkIndex: 0,
      resolution: "ours",
    });
    expect(result).toEqual({ ok: true });
  });

  test("git.fetch/pull/push dispatch and return ok", async () => {
    expect(await h.dispatch("git.fetch", { worktreePath: "/wt" })).toEqual({ ok: true });
    expect(await h.dispatch("git.pull", { worktreePath: "/wt" })).toEqual({ ok: true });
    expect(await h.dispatch("git.push", { worktreePath: "/wt", remote: "origin", branch: "main" })).toEqual({
      ok: true,
    });
  });

  test("diff.get forwards staged flag for the staged pane", async () => {
    const result = (await h.dispatch("diff.get", { worktreePath: "/wt", staged: true })) as {
      files: unknown[];
    };
    expect(result).toHaveProperty("files");
  });

  test("kanban.list with empty projectId returns all tasks", async () => {
    const p1 = (await h.dispatch("project.add", { path: "/tmp/p1" })) as { id: string };
    const p2 = (await h.dispatch("project.add", { path: "/tmp/p2" })) as { id: string };
    await h.dispatch("kanban.upsert", { task: { projectId: p1.id, title: "t1" } });
    await h.dispatch("kanban.upsert", { task: { projectId: p2.id, title: "t2" } });
    const all = (await h.dispatch("kanban.list", { projectId: "" })) as KanbanTask[];
    expect(all.length).toBe(2);
  });

  test("file.tree", async () => {
    const t = await h.dispatch("file.tree", { worktreePath: "/wt" });
    expect(t).toEqual([]);
  });

  test("kanban.list/upsert", async () => {
    const proj = (await h.dispatch("project.add", { path: "/k" })) as { id: string };
    const t = (await h.dispatch("kanban.upsert", {
      task: { projectId: proj.id, title: "T" },
    })) as { id: string };
    expect(t.id.startsWith("task_")).toBe(true);
    const list = (await h.dispatch("kanban.list", { projectId: proj.id })) as unknown[];
    expect(list).toHaveLength(1);
  });

  test("kanban.upsert accepts flat params too", async () => {
    const proj = (await h.dispatch("project.add", { path: "/k2" })) as { id: string };
    const t = (await h.dispatch("kanban.upsert", {
      projectId: proj.id,
      title: "flat",
    })) as { id: string };
    expect(t).toBeDefined();
  });

  test("kanban.upsert throws on missing fields", async () => {
    await expect(h.dispatch("kanban.upsert", { task: {} })).rejects.toThrow();
  });

  test("preset.list/launch/save_current", async () => {
    const list = (await h.dispatch("preset.list", { projectPath: "/r" })) as unknown[];
    expect(list).toHaveLength(1);
    const r = (await h.dispatch("preset.launch", {
      preset: { name: "p", layout: { type: "terminal", agent: "claude", cwd: "{{workspace_root}}", mode: "agent" } },
      projectPath: "/r",
    })) as { workspaceId: string };
    expect(r.workspaceId).toBeDefined();
    const saved = (await h.dispatch("preset.save_current", {
      workspaceId: "ws",
      name: "n",
      layout: { type: "browser" },
    })) as { name: string };
    expect(saved.name).toBe("n");
  });

  test("mcp.start/stop/list", async () => {
    await h.dispatch("mcp.start", { name: "fs", projectPath: "/r" });
    const list = (await h.dispatch("mcp.list", {})) as unknown[];
    expect(list).toHaveLength(1);
    await h.dispatch("mcp.stop", { name: "fs" });
  });

  test("context.usage", async () => {
    const u = (await h.dispatch("context.usage", { sessionId: "s" })) as { tokensUsed: number };
    expect(u.tokensUsed).toBe(0);
  });

  test("attachment.create", async () => {
    const r = (await h.dispatch("attachment.create", { worktreePath: "/r", text: "small" })) as {
      ref: string;
    };
    expect(r.ref).toBe("small");
  });

  test("automation.run", async () => {
    const r = (await h.dispatch("automation.run", {
      automationName: "auto",
      projectPath: "/r",
      worktreePath: "/wt",
    })) as { stepsRun: number };
    expect(r.stepsRun).toBe(1);
  });

  test("notify.send", async () => {
    const r = (await h.dispatch("notify.send", { title: "t", body: "b" })) as { ok: boolean };
    expect(r.ok).toBe(true);
  });

  test("notify lifecycle: send persists, list returns it, mark read flips state, unreadCount updates", async () => {
    const ids = (() => {
      let n = 0;
      return { uuid: (p: string) => `${p}_${++n}`, now: () => 1_700_000_000_000 };
    })();
    const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir(), ids });
    const handlers = new RpcHandlers({ store });

    const created = (await handlers.dispatch("notify.send", {
      title: "Done",
      body: "Build passed",
      type: "build.result",
    })) as { id: string; title: string; read: boolean };
    expect(created.title).toBe("Done");
    expect(created.read).toBe(false);

    const list = (await handlers.dispatch("notify.list", {})) as Array<{ id: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    const beforeMark = (await handlers.dispatch("notify.unreadCount", {})) as { count: number };
    expect(beforeMark.count).toBe(1);

    await handlers.dispatch("notify.markRead", { id: created.id });
    const afterMark = (await handlers.dispatch("notify.unreadCount", {})) as { count: number };
    expect(afterMark.count).toBe(0);

    await handlers.dispatch("notify.send", { title: "Second", body: "" });
    await handlers.dispatch("notify.send", { title: "Third", body: "" });
    expect(((await handlers.dispatch("notify.unreadCount", {})) as { count: number }).count).toBe(2);
    await handlers.dispatch("notify.markAllRead", {});
    expect(((await handlers.dispatch("notify.unreadCount", {})) as { count: number }).count).toBe(0);

    const unreadOnly = (await handlers.dispatch("notify.list", { unreadOnly: true })) as unknown[];
    expect(unreadOnly).toHaveLength(0);
  });

  test("caffeinate start/status/stop lifecycle", async () => {
    const ids = (() => {
      let n = 0;
      return { uuid: (p: string) => `${p}_${++n}`, now: () => 1_700_000_000_000 };
    })();
    const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir(), ids });
    const killed: boolean[] = [];
    const caffeinate = new Caffeinate({
      platform: "darwin",
      spawn: (() => ({
        exitCode: null,
        exited: new Promise<number>(() => {}),
        kill() { killed.push(true); },
      })) as unknown as Spawner,
    });
    const handlers = new RpcHandlers({ store, caffeinate });

    expect(((await handlers.dispatch("caffeinate.status", {})) as { active: boolean }).active).toBe(false);
    const started = (await handlers.dispatch("caffeinate.start", {})) as { started: boolean; active: boolean };
    expect(started.started).toBe(true);
    expect(started.active).toBe(true);
    expect(((await handlers.dispatch("caffeinate.status", {})) as { active: boolean }).active).toBe(true);
    const stopped = (await handlers.dispatch("caffeinate.stop", {})) as { stopped: boolean; active: boolean };
    expect(stopped.stopped).toBe(true);
    expect(stopped.active).toBe(false);
    expect(killed).toHaveLength(1);
  });

  test("context.usage + context.record round-trip", async () => {
    const proj = (await h.dispatch("project.add", { path: "/ctx" })) as { id: string };
    const ws = (await h.dispatch("workspace.create", {
      projectId: proj.id,
      projectPath: "/ctx",
      branch: "main",
      backend: "claude",
    })) as { sessionId: string };

    const before = (await h.dispatch("context.usage", { sessionId: ws.sessionId })) as {
      tokensUsed: number;
    };
    expect(before.tokensUsed).toBe(0);

    const recorded = (await h.dispatch("context.record", {
      sessionId: ws.sessionId,
      tokensUsed: 4321,
      costEstimate: 0.42,
    })) as { tokensUsed: number; sessionCostEstimate: number };
    expect(recorded.tokensUsed).toBe(4321);
    expect(recorded.sessionCostEstimate).toBeCloseTo(0.42);

    const after = (await h.dispatch("context.usage", { sessionId: ws.sessionId })) as {
      tokensUsed: number;
    };
    expect(after.tokensUsed).toBe(4321);
  });

  test("instructions.resolve dispatches to the resolver", async () => {
    const ids = (() => {
      let n = 0;
      return { uuid: (p: string) => `${p}_${++n}`, now: () => 1_700_000_000_000 };
    })();
    const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir(), ids });
    const instructions = new InstructionsResolver({
      home: "/home/test",
      exists: (p: string) => p === "/wt/MAVERICK.md",
      readFile: () => "project rules",
    });
    const handlers = new RpcHandlers({ store, instructions });
    const result = (await handlers.dispatch("instructions.resolve", {
      worktreePath: "/wt",
    })) as { project: string; projectSource: string | null; global: string };
    expect(result.project).toBe("project rules");
    expect(result.projectSource).toBe("MAVERICK.md");
    expect(result.global).toBe("");
  });

  test("unknown method throws", async () => {
    await expect(h.dispatch("does.not.exist", {})).rejects.toThrow(/Unknown method/);
  });

  test("validation errors propagate (missing required field)", async () => {
    await expect(h.dispatch("project.add", {})).rejects.toThrow();
  });

  test("default constructor builds without injected deps", () => {
    expect(new RpcHandlers()).toBeInstanceOf(RpcHandlers);
  });

  it("project.settings.get returns defaults for a path without maverick.json", async () => {
    const { handlers, projectId } = makeWithTempProject();
    const result = (await handlers.dispatch("project.settings.get", { projectId })) as { name: string; scripts: { setup: string } };
    expect(result.scripts.setup).toBe("");
  });

  it("project.settings.update writes patch and returns saved value", async () => {
    const { handlers, projectId } = makeWithTempProject();
    const saved = (await handlers.dispatch("project.settings.update", {
      projectId,
      patch: { scripts: { setup: "bun install", run: "", archive: "" } },
    })) as { scripts: { setup: string } };
    expect(saved.scripts.setup).toBe("bun install");

    const reread = (await handlers.dispatch("project.settings.get", { projectId })) as { scripts: { setup: string } };
    expect(reread.scripts.setup).toBe("bun install");
  });

  it("project.settings.openFile returns the absolute path", async () => {
    const { handlers, dir, projectId } = makeWithTempProject();
    const res = (await handlers.dispatch("project.settings.openFile", { projectId })) as { path: string };
    expect(res.path).toBe(`${dir}/maverick.json`);
  });

  it("workspace.create runs scripts.setup when configured", async () => {
    const { mkdirSync, existsSync, readFileSync } = await import("fs");
    const { handlers, dir, projectId, store } = makeWithTempProject();

    await handlers.dispatch("project.settings.update", {
      projectId,
      patch: { scripts: { setup: "echo setup-ran > .setup-marker", run: "", archive: "" } },
    });

    const baseDir = `${dir}/.worktrees`;
    mkdirSync(baseDir, { recursive: true });

    const wtPath = `${dir}/wt-setup`;
    mkdirSync(wtPath, { recursive: true });
    const fakeWorktree = {
      async create() { return { workspaceId: "ws_setup", worktreePath: wtPath }; },
      async destroy() { return { ok: true as const }; },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h2 = new RpcHandlers({ store, worktree: fakeWorktree as never, notifier: { write: () => {} } });
    await h2.dispatch("project.settings.update", {
      projectId,
      patch: { scripts: { setup: "echo setup-ran > .setup-marker", run: "", archive: "" } },
    });
    const ws = (await h2.dispatch("workspace.create", {
      projectId,
      projectPath: dir,
      branch: "feat/setup",
      backend: "claude",
    })) as { id: string; worktreePath: string };

    expect(ws.worktreePath).toBe(wtPath);
    expect(existsSync(`${wtPath}/.setup-marker`)).toBe(true);
    expect(readFileSync(`${wtPath}/.setup-marker`, "utf8").trim()).toBe("setup-ran");
  });

  it("workspace.create skips setup when scripts.setup is empty", async () => {
    const { mkdirSync, existsSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();
    const wtPath = `${dir}/wt-no-setup`;
    mkdirSync(wtPath, { recursive: true });
    const fakeWorktree = {
      async create() { return { workspaceId: "ws_no_setup", worktreePath: wtPath }; },
      async destroy() { return { ok: true as const }; },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({ store, worktree: fakeWorktree as never, notifier: { write: () => {} } });
    await h.dispatch("workspace.create", {
      projectId,
      projectPath: dir,
      branch: "feat/no-setup",
      backend: "claude",
    });
    expect(existsSync(`${wtPath}/.setup-marker`)).toBe(false);
  });

  it("workspace.destroy runs scripts.archive before deleting worktree", async () => {
    const { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } = await import("fs");
    const { handlers, dir, projectId, store } = makeWithTempProject();

    const wtPath = `${dir}/wt-archive`;
    mkdirSync(wtPath, { recursive: true });
    const markerPath = `${dir}/.archive-marker`;
    if (existsSync(markerPath)) unlinkSync(markerPath);

    const fakeWorktree = {
      async create() { return { workspaceId: "ws_arch", worktreePath: wtPath }; },
      async destroy() { return { ok: true as const }; },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({ store, worktree: fakeWorktree as never, notifier: { write: () => {} } });

    await h.dispatch("project.settings.update", {
      projectId,
      patch: { scripts: { setup: "", run: "", archive: `echo archived > ${markerPath}` } },
    });
    const ws = (await h.dispatch("workspace.create", {
      projectId, projectPath: dir, branch: "feat/archive", backend: "claude",
    })) as { id: string };

    await h.dispatch("workspace.destroy", { workspaceId: ws.id });

    expect(existsSync(markerPath)).toBe(true);
    expect(readFileSync(markerPath, "utf8").trim()).toBe("archived");
  });

  it("workspace.destroy skips archive when scripts.archive is empty", async () => {
    const { mkdirSync, existsSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();
    const wtPath = `${dir}/wt-no-archive`;
    mkdirSync(wtPath, { recursive: true });
    const fakeWorktree = {
      async create() { return { workspaceId: "ws_no_arch", worktreePath: wtPath }; },
      async destroy() { return { ok: true as const }; },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({ store, worktree: fakeWorktree as never, notifier: { write: () => {} } });
    const ws = (await h.dispatch("workspace.create", {
      projectId, projectPath: dir, branch: "feat/no-archive", backend: "claude",
    })) as { id: string };
    const result = (await h.dispatch("workspace.destroy", { workspaceId: ws.id })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(existsSync(wtPath)).toBe(true);
  });

  it("emits project.settings.changed after successful update", async () => {
    const { handlers, projectId, notifications } = makeWithTempProject();
    await handlers.dispatch("project.settings.update", { projectId, patch: { remote: "alpha" } });
    const changed = notifications.filter((n) => n.method === "project.settings.changed");
    expect(changed.length).toBe(1);
    expect((changed[0].params as { projectId: string }).projectId).toBe(projectId);
    expect((changed[0].params as { settings: { remote: string } }).settings.remote).toBe("alpha");
  });

  it("emits project.settings.changed when file is edited externally", async () => {
    const { handlers, dir, projectId, notifications } = makeWithTempProject();
    await handlers.dispatch("project.settings.get", { projectId });
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.join(dir, "maverick.json");
    const writePayload = (remote: string): void => {
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          { version: 1, backends: { default: "claude", available: [] }, project: { remote } },
          null,
          2
        )
      );
    };
    const filterChanged = (): Array<{ method: string; params: unknown }> =>
      notifications.filter((n) => n.method === "project.settings.changed");
    const deadline = Date.now() + 2000;
    let attempt = 0;
    while (Date.now() < deadline && filterChanged().length === 0) {
      writePayload(`beta-${attempt++}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(filterChanged().length).toBeGreaterThan(0);
  });
});
