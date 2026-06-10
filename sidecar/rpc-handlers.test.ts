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
import { UsageTracker } from "./usage-tracker";
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
  const usage = new UsageTracker({
    claudeDir: "/nonexistent/claude",
    codexDir: "/nonexistent/codex",
  });
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
    presets, kanban, automations, mcp, notifications, context, usage, attachments, fileTree,
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

  test("file.read delegates to FileReader", async () => {
    const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir() });
    const fileReader = {
      read: (p: { filePath: string }) => ({
        content: `body:${p.filePath}`,
        size: 4,
        binary: false,
        unreadable: false,
      }),
    } as never;
    const handlers = new RpcHandlers({ store, fileReader, notifier: { write: () => {} } });
    const res = (await handlers.dispatch("file.read", { filePath: "/wt/a.md" })) as {
      content: string;
    };
    expect(res.content).toBe("body:/wt/a.md");
  });

  test("file.search delegates to FileSearch", async () => {
    const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir() });
    let received: unknown;
    const fileSearch = {
      async search(p: unknown) {
        received = p;
        return { hits: [{ rel: "a.ts", name: "a.ts", isDirectory: false }], truncated: true };
      },
    } as never;
    const handlers = new RpcHandlers({ store, fileSearch, notifier: { write: () => {} } });
    const res = (await handlers.dispatch("file.search", {
      worktreePath: "/wt",
      query: "a",
      limit: 5,
    })) as { hits: unknown[]; truncated: boolean };
    expect(res.truncated).toBe(true);
    expect(received).toEqual({ worktreePath: "/wt", query: "a", limit: 5 });
  });

  test("fs.watch.start/add/remove/stop delegate to FsWatcher", async () => {
    const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir() });
    const calls: string[] = [];
    const fsWatcher = {
      start: (p: { root: string }) => {
        calls.push(`start:${p.root}`);
        return { watching: 1 };
      },
      add: (p: { dirs: string[] }) => {
        calls.push(`add:${p.dirs.join(",")}`);
        return { watching: 2 };
      },
      remove: (p: { dirs: string[] }) => {
        calls.push(`remove:${p.dirs.join(",")}`);
        return { watching: 1 };
      },
      stop: () => {
        calls.push("stop");
        return { ok: true as const };
      },
    } as never;
    const handlers = new RpcHandlers({ store, fsWatcher, notifier: { write: () => {} } });
    expect(await handlers.dispatch("fs.watch.start", { root: "/wt", dirs: ["/wt/src"] })).toEqual({
      watching: 1,
    });
    expect(await handlers.dispatch("fs.watch.add", { dirs: ["/wt/lib"] })).toEqual({ watching: 2 });
    expect(await handlers.dispatch("fs.watch.remove", { dirs: ["/wt/lib"] })).toEqual({
      watching: 1,
    });
    expect(await handlers.dispatch("fs.watch.stop", {})).toEqual({ ok: true });
    expect(calls).toEqual(["start:/wt", "add:/wt/lib", "remove:/wt/lib", "stop"]);
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

  test("preset.save_current persists via the default store-backed launcher and is listed", async () => {
    const { handlers, dir, store } = makeWithTempProject();
    const ws = store.workspaceCreate({
      projectId: store.projectByPath(dir)!.id,
      branch: "main",
      agentBackend: "claude",
      worktreePath: `${dir}/wt`,
    });
    const layout = { type: "terminal", agent: "claude", cwd: "{{workspace_root}}", mode: "agent" };
    const saved = (await handlers.dispatch("preset.save_current", {
      workspaceId: ws.id,
      name: "stored",
      layout,
      baseBranch: "dev",
    })) as { name: string };
    expect(saved.name).toBe("stored");
    const list = (await handlers.dispatch("preset.list", { projectPath: dir })) as Array<{ name: string }>;
    expect(list.map((p) => p.name)).toContain("stored");
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

  test("usage.summary", async () => {
    const s = (await h.dispatch("usage.summary", {})) as {
      date: string;
      backends: Array<{ backend: string }>;
    };
    expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.backends.map((b) => b.backend)).toEqual(["claude-code", "codex", "antigravity"]);
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

  test("automation.run accepts a null workspaceId with explicit paths", async () => {
    // Mirrors the Rust automation_run(workspace_id: Option<String>) None → JSON
    // null path; the schema's nullishOptional must coerce null away and run
    // from the supplied projectPath + worktreePath.
    const r = (await h.dispatch("automation.run", {
      automationName: "auto",
      workspaceId: null,
      projectPath: "/r",
      worktreePath: "/wt",
    })) as { stepsRun: number };
    expect(r.stepsRun).toBe(1);
  });

  test("automation.run reports its accepted inputs when none are resolvable", async () => {
    await expect(
      h.dispatch("automation.run", { automationName: "auto" })
    ).rejects.toThrow(/workspaceId or projectPath \+ worktreePath/);
  });

  describe("workspaceId → {projectPath, worktreePath} contract resolution", () => {
    // Pins the field names the frontend panels send (workspaceId) through to the
    // schema the sidecar engines require (projectPath/worktreePath). Each command
    // must resolve the workspace from the store rather than ZodError on the
    // missing path fields.
    async function seedWorkspace(): Promise<{ workspaceId: string }> {
      const proj = (await h.dispatch("project.add", { path: "/r" })) as { id: string };
      const ws = (await h.dispatch("workspace.create", {
        projectId: proj.id,
        projectPath: "/r",
        branch: "feat",
        backend: "claude",
      })) as { id: string };
      return { workspaceId: ws.id };
    }

    test("skills.run resolves projectPath from workspaceId", async () => {
      const { workspaceId } = await seedWorkspace();
      const r = (await h.dispatch("skills.run", {
        workspaceId,
        skillName: "review",
        vars: { x: "1" },
      })) as { prompt: string };
      expect(r.prompt).toBe("p 1");
    });

    test("automation.run resolves projectPath + worktreePath from workspaceId", async () => {
      const { workspaceId } = await seedWorkspace();
      const r = (await h.dispatch("automation.run", {
        automationName: "auto",
        workspaceId,
      })) as { stepsRun: number };
      expect(r.stepsRun).toBe(1);
    });

    test("mcp.start resolves projectPath from workspaceId", async () => {
      const { workspaceId } = await seedWorkspace();
      const r = (await h.dispatch("mcp.start", { name: "fs", workspaceId })) as { pid?: number };
      expect(r).toBeDefined();
      await h.dispatch("mcp.stop", { name: "fs" });
    });

    test("skills.run throws a clear error when neither workspaceId nor projectPath is given", async () => {
      await expect(
        h.dispatch("skills.run", { skillName: "review", vars: {} })
      ).rejects.toThrow(/workspaceId or projectPath is required/);
    });

    test("automation.run throws when the workspace cannot be resolved", async () => {
      await expect(
        h.dispatch("automation.run", { automationName: "auto", workspaceId: "missing" })
      ).rejects.toThrow(/workspace missing not found/);
    });

    test("mcp.start without a projectPath or workspaceId still starts (no project scope)", async () => {
      const r = (await h.dispatch("mcp.start", { name: "fs" })) as { pid?: number };
      expect(r).toBeDefined();
      await h.dispatch("mcp.stop", { name: "fs" });
    });

    test("skills.run throws when the workspace's project row is gone (orphan)", async () => {
      const proj = (await h.dispatch("project.add", { path: "/orphan" })) as { id: string };
      const ws = (await h.dispatch("workspace.create", {
        projectId: proj.id,
        projectPath: "/orphan",
        branch: "feat",
        backend: "claude",
      })) as { id: string };
      // Drop the project out from under the workspace (FK off so the orphan persists).
      h.store.db.run("PRAGMA foreign_keys=OFF");
      h.store.db.query("DELETE FROM projects WHERE id = ?").run(proj.id);
      h.store.db.run("PRAGMA foreign_keys=ON");
      await expect(
        h.dispatch("skills.run", { workspaceId: ws.id, skillName: "review", vars: {} })
      ).rejects.toThrow(new RegExp(`project ${proj.id} not found`));
    });
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

  test("mcp.logs returns the captured ring page", async () => {
    await h.dispatch("mcp.start", { name: "fs", projectPath: "/r" });
    const page = (await h.dispatch("mcp.logs", { name: "fs" })) as {
      data: string;
      nextOffset: number;
      dropped: number;
    };
    expect(page).toHaveProperty("nextOffset");
    expect(page).toHaveProperty("dropped");
    await h.dispatch("mcp.stop", { name: "fs" });
  });

  test("mcp.logs accepts an explicit sinceOffset", async () => {
    await h.dispatch("mcp.start", { name: "fs", projectPath: "/r" });
    const page = (await h.dispatch("mcp.logs", { name: "fs", sinceOffset: 0 })) as {
      nextOffset: number;
    };
    expect(page.nextOffset).toBe(0);
    await h.dispatch("mcp.stop", { name: "fs" });
  });

  test("pollMcpHealth ticks the manager without throwing", () => {
    expect(() => h.pollMcpHealth()).not.toThrow();
  });

  test("config.save persists a patch and config.load reflects it", () => {
    const files: Record<string, string> = {
      "/r/maverick.yaml":
        "version: 1\nbackends:\n  default: claude\n  available: []\n",
    };
    const config = new ConfigLoader({
      read: (p) => files[p] ?? "",
      exists: (p) => p in files,
      write: (p, c) => {
        files[p] = c;
      },
    });
    const handlers = new RpcHandlers({ config, notifier: { write: () => {} } });
    return (async () => {
      const saved = (await handlers.dispatch("config.save", {
        projectPath: "/r",
        patch: { automations: [{ name: "ship", trigger: "manual", steps: [] }] },
      })) as { automations: Array<{ name: string }> };
      expect(saved.automations[0].name).toBe("ship");
      const reloaded = (await handlers.dispatch("config.load", { projectPath: "/r" })) as {
        automations: Array<{ name: string }>;
      };
      expect(reloaded.automations[0].name).toBe("ship");
    })();
  });

  test("mcp.add appends a server to the config and persists it", async () => {
    const files: Record<string, string> = {
      "/r/maverick.yaml":
        "version: 1\nbackends:\n  default: claude\n  available: []\nmcps:\n  - { name: existing, command: c, args: [] }\n",
    };
    const config = new ConfigLoader({
      read: (p) => files[p] ?? "",
      exists: (p) => p in files,
      write: (p, c) => {
        files[p] = c;
      },
    });
    const handlers = new RpcHandlers({ config, notifier: { write: () => {} } });
    const r = (await handlers.dispatch("mcp.add", {
      name: "fs",
      command: "mcp-fs",
      args: ["-y"],
      env: { K: "V" },
      projectPath: "/r",
    })) as { ok: boolean };
    expect(r.ok).toBe(true);
    const reloaded = (await handlers.dispatch("config.load", { projectPath: "/r" })) as {
      mcps: Array<{ name: string }>;
    };
    expect(reloaded.mcps.map((m) => m.name).sort()).toEqual(["existing", "fs"]);
  });

  test("mcp.add replaces a server of the same name (no duplicate)", async () => {
    const files: Record<string, string> = {
      "/r/maverick.yaml":
        "version: 1\nbackends:\n  default: claude\n  available: []\nmcps:\n  - { name: fs, command: old, args: [] }\n",
    };
    const config = new ConfigLoader({
      read: (p) => files[p] ?? "",
      exists: (p) => p in files,
      write: (p, c) => {
        files[p] = c;
      },
    });
    const handlers = new RpcHandlers({ config, notifier: { write: () => {} } });
    await handlers.dispatch("mcp.add", { name: "fs", command: "new", args: [], projectPath: "/r" });
    const reloaded = (await handlers.dispatch("config.load", { projectPath: "/r" })) as {
      mcps: Array<{ name: string; command: string }>;
    };
    expect(reloaded.mcps).toHaveLength(1);
    expect(reloaded.mcps[0].command).toBe("new");
  });

  test("mcp.add throws without a workspaceId or projectPath", async () => {
    await expect(h.dispatch("mcp.add", { name: "x", command: "c", args: [] })).rejects.toThrow(
      /workspaceId or projectPath/
    );
  });

  test("mcp.add resolves projectPath from workspaceId", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mvk-mcpadd-"));
    const files: Record<string, string> = {
      [join(dir, "maverick.yaml")]:
        "version: 1\nbackends:\n  default: claude\n  available: []\n",
    };
    const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir() });
    const config = new ConfigLoader({
      read: (p) => files[p] ?? "",
      exists: (p) => p in files,
      write: (p, c) => {
        files[p] = c;
      },
    });
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
      async create() {
        return { workspaceId: "ws_add", worktreePath: `${dir}/wt` };
      },
      async destroy() {
        return { ok: true as const };
      },
      async list() {
        return [];
      },
      async prune() {
        return { ok: true as const };
      },
    };
    const handlers = new RpcHandlers({
      store,
      config,
      worktree: fakeWorktree as never,
      notifier: { write: () => {} },
    });
    const proj = (await handlers.dispatch("project.add", { path: dir })) as { id: string };
    const ws = (await handlers.dispatch("workspace.create", {
      projectId: proj.id,
      projectPath: dir,
      branch: "feat",
      backend: "claude",
    })) as { id: string };
    const r = (await handlers.dispatch("mcp.add", {
      name: "fs",
      command: "c",
      args: [],
      workspaceId: ws.id,
    })) as { ok: boolean };
    expect(r.ok).toBe(true);
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

  it("workspace.create does NOT run scripts.setup (the Setup tab streams it)", async () => {
    const { mkdirSync, existsSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();

    const wtPath = `${dir}/wt-setup`;
    mkdirSync(wtPath, { recursive: true });
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
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
    })) as { id: string; worktreePath: string; status: string };

    expect(ws.worktreePath).toBe(wtPath);
    expect(ws.status).toBe("idle");
    expect(existsSync(`${wtPath}/.setup-marker`)).toBe(false);
  });

  it("workspace.create with no setup script still creates the workspace", async () => {
    const { mkdirSync, existsSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();
    const wtPath = `${dir}/wt-no-setup`;
    mkdirSync(wtPath, { recursive: true });
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
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
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
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
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
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

  it("workspace.destroy removes the worktree before deleting the DB row", async () => {
    const { mkdirSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();
    const wtPath = `${dir}/wt-order`;
    mkdirSync(wtPath, { recursive: true });
    const order: string[] = [];
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
      async create() { return { workspaceId: "ws_order", worktreePath: wtPath }; },
      async destroy() {
        // The row must still exist when the worktree is being removed.
        order.push(store.workspaceGet("ws_order") ? "destroy-with-row" : "destroy-without-row");
        return { ok: true as const };
      },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({ store, worktree: fakeWorktree as never, notifier: { write: () => {} } });
    const ws = (await h.dispatch("workspace.create", {
      projectId, projectPath: dir, branch: "feat/order", backend: "claude",
    })) as { id: string };
    await h.dispatch("workspace.destroy", { workspaceId: ws.id });
    expect(order).toEqual(["destroy-with-row"]);
    // Row is gone only after the worktree was removed.
    expect(store.workspaceGet(ws.id)).toBeNull();
  });

  it("workspace.destroy keeps the DB row when worktree removal fails (no orphan)", async () => {
    const { mkdirSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();
    const wtPath = `${dir}/wt-orphan`;
    mkdirSync(wtPath, { recursive: true });
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
      async create() { return { workspaceId: "ws_orphan", worktreePath: wtPath }; },
      async destroy() { throw new Error("remove and prune both failed"); },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({ store, worktree: fakeWorktree as never, notifier: { write: () => {} } });
    const ws = (await h.dispatch("workspace.create", {
      projectId, projectPath: dir, branch: "feat/orphan", backend: "claude",
    })) as { id: string };
    await expect(h.dispatch("workspace.destroy", { workspaceId: ws.id })).rejects.toThrow();
    // The worktree could not be removed, so the row must survive — the worktree
    // is still referenced and therefore recoverable, not orphaned.
    expect(store.workspaceGet(ws.id)).not.toBeNull();
  });

  it("workspace.destroy on an unknown workspace is a no-op", async () => {
    const { store } = makeWithTempProject();
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
      async create() { return { workspaceId: "x", worktreePath: "/x" }; },
      async destroy() { throw new Error("should not be called"); },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({ store, worktree: fakeWorktree as never, notifier: { write: () => {} } });
    const result = (await h.dispatch("workspace.destroy", { workspaceId: "nope" })) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("workspace.create generates a unique callsign branch and title when branch is omitted", async () => {
    const { mkdirSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();
    const wtPath = `${dir}/wt-named`;
    mkdirSync(wtPath, { recursive: true });
    let received: { branch?: string; dirName?: string; baseBranch?: string } = {};
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
      async create(params: { branch: string; dirName?: string; baseBranch?: string }) {
        received = params;
        return { workspaceId: "ws_named", worktreePath: wtPath };
      },
      async destroy() { return { ok: true as const }; },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const fakeGit = {
      async allBranchNames() { return ["main", "origin/main"]; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({
      store,
      worktree: fakeWorktree as never,
      git: fakeGit as never,
      notifier: { write: () => {} },
    });
    const ws = (await h.dispatch("workspace.create", {
      projectId, projectPath: dir, branch: null, backend: "claude",
    })) as { branch: string; title?: string };

    expect(ws.branch.length).toBeGreaterThan(0);
    expect(ws.branch).not.toBe("main");
    expect(ws.title).toBeDefined();
    expect(ws.title!.toLowerCase().replace(/ /g, "-")).toBe(ws.branch);
    expect(received.branch).toBe(ws.branch);
    expect(received.dirName).toBe(ws.branch);
    // origin/main came from default settings branchFrom.
    expect(received.baseBranch).toBe("origin/main");
    expect(store.workspaceGet("ws_named")?.title).toBe(ws.title);
  });

  it("workspace.create generates a name even when branch listing fails", async () => {
    const { mkdirSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();
    const wtPath = `${dir}/wt-named-2`;
    mkdirSync(wtPath, { recursive: true });
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
      async create() { return { workspaceId: "ws_named_2", worktreePath: wtPath }; },
      async destroy() { return { ok: true as const }; },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const fakeGit = {
      async allBranchNames() { throw new Error("not a git repo"); },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({
      store,
      worktree: fakeWorktree as never,
      git: fakeGit as never,
      notifier: { write: () => {} },
    });
    const ws = (await h.dispatch("workspace.create", {
      projectId, projectPath: dir, backend: "claude",
    })) as { branch: string };
    expect(ws.branch.length).toBeGreaterThan(0);
  });

  it("workspace.create passes an explicit baseBranch ahead of settings", async () => {
    const { mkdirSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();
    const wtPath = `${dir}/wt-base`;
    mkdirSync(wtPath, { recursive: true });
    let received: { baseBranch?: string; base?: string } = {};
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
      async create(params: { baseBranch?: string; base?: string }) {
        received = params;
        return { workspaceId: "ws_base", worktreePath: wtPath };
      },
      async destroy() { return { ok: true as const }; },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({ store, worktree: fakeWorktree as never, notifier: { write: () => {} } });
    await h.dispatch("workspace.create", {
      projectId, projectPath: dir, branch: "feat/x", backend: "claude", baseBranch: "develop",
    });
    expect(received.baseBranch).toBe("develop");
    // Worktrees default to the home-rooted base, outside the user's checkout.
    expect(received.base).toContain("/.maverick/");
    expect(received.base).toContain("/worktrees");
    expect(received.base!.startsWith(dir)).toBe(false);
  });

  it("git.remote_info dispatches to the git module", async () => {
    const { store } = makeWithTempProject();
    const fakeGit = {
      async remoteInfo(p: { worktreePath: string; remote?: string }) {
        return { provider: "bitbucket", host: "bitbucket.org", owner: "o", repo: "r", webUrl: "https://bitbucket.org/o/r", remoteUrl: "u", requested: p.remote };
      },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({ store, git: fakeGit as never, notifier: { write: () => {} } });
    const info = (await h.dispatch("git.remote_info", { worktreePath: "/w" })) as { provider: string };
    expect(info.provider).toBe("bitbucket");
  });

  it("ai.commit_message dispatches to the generator", async () => {
    const { store } = makeWithTempProject();
    const fakeGen = {
      async generate(p: { worktreePath: string }) {
        return { message: `feat: from ${p.worktreePath}` };
      },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({ store, commitMessage: fakeGen as never, notifier: { write: () => {} } });
    const r = (await h.dispatch("ai.commit_message", { worktreePath: "/w" })) as { message: string };
    expect(r.message).toBe("feat: from /w");
  });

  it("workspace.destroy kills a hung archive child when the timeout wins", async () => {
    const { mkdirSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();
    const wtPath = `${dir}/wt-archive-timeout`;
    mkdirSync(wtPath, { recursive: true });
    let killed = false;
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
      async create() { return { workspaceId: "ws_arch_to", worktreePath: wtPath }; },
      async destroy() { return { ok: true as const }; },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    // An archive that never exits; the handler's 30s timeout must kill it.
    const hungProc = {
      exitCode: null as number | null,
      exited: new Promise<number>(() => {}),
      kill() { killed = true; },
    };
    const fakeProcess = {
      async spawnOnce() { return { code: 0 }; },
      spawnOnceHandle() { return { proc: hungProc, exited: hungProc.exited }; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({
      store,
      worktree: fakeWorktree as never,
      process: fakeProcess as never,
      notifier: { write: () => {} },
    });
    await h.dispatch("project.settings.update", {
      projectId,
      patch: { scripts: { setup: "", run: "", archive: "sleep 9999" } },
    });
    const ws = (await h.dispatch("workspace.create", {
      projectId, projectPath: dir, branch: "feat/arch-to", backend: "claude",
    })) as { id: string };

    // Override timers so the 30s race resolves immediately without real waiting.
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as never;
    try {
      await h.dispatch("workspace.destroy", { workspaceId: ws.id });
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    expect(killed).toBe(true);
    expect(store.workspaceGet(ws.id)).toBeNull();
  });

  it("workspace.destroy ignores a kill that throws on an already-exited child", async () => {
    const { mkdirSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();
    const wtPath = `${dir}/wt-archive-killthrow`;
    mkdirSync(wtPath, { recursive: true });
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
      async create() { return { workspaceId: "ws_arch_kt", worktreePath: wtPath }; },
      async destroy() { return { ok: true as const }; },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const hungProc = {
      exitCode: null as number | null,
      exited: new Promise<number>(() => {}),
      kill() { throw new Error("already exited"); },
    };
    const fakeProcess = {
      async spawnOnce() { return { code: 0 }; },
      spawnOnceHandle() { return { proc: hungProc, exited: hungProc.exited }; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({
      store,
      worktree: fakeWorktree as never,
      process: fakeProcess as never,
      notifier: { write: () => {} },
    });
    await h.dispatch("project.settings.update", {
      projectId,
      patch: { scripts: { setup: "", run: "", archive: "sleep 9999" } },
    });
    const ws = (await h.dispatch("workspace.create", {
      projectId, projectPath: dir, branch: "feat/arch-kt", backend: "claude",
    })) as { id: string };
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as never;
    try {
      const r = (await h.dispatch("workspace.destroy", { workspaceId: ws.id })) as { ok: boolean };
      expect(r.ok).toBe(true);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it("workspace.destroy logs and continues when the archive child errors", async () => {
    const { mkdirSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();
    const wtPath = `${dir}/wt-archive-err`;
    mkdirSync(wtPath, { recursive: true });
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
      async create() { return { workspaceId: "ws_arch_err", worktreePath: wtPath }; },
      async destroy() { return { ok: true as const }; },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const fakeProcess = {
      async spawnOnce() { return { code: 0 }; },
      spawnOnceHandle() {
        return { proc: { kill() {} }, exited: Promise.reject(new Error("archive boom")) };
      },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({
      store,
      worktree: fakeWorktree as never,
      process: fakeProcess as never,
      notifier: { write: () => {} },
    });
    await h.dispatch("project.settings.update", {
      projectId,
      patch: { scripts: { setup: "", run: "", archive: "false" } },
    });
    const ws = (await h.dispatch("workspace.create", {
      projectId, projectPath: dir, branch: "feat/arch-err", backend: "claude",
    })) as { id: string };
    const r = (await h.dispatch("workspace.destroy", { workspaceId: ws.id })) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(store.workspaceGet(ws.id)).toBeNull();
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
