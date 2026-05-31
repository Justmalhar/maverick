import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as api from "./tauri";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined as never);
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(() => {});
});

describe("tauri command wrappers", () => {
  it("projectAdd / projectList", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: "p1" } as never);
    await api.projectAdd("/tmp");
    expect(invoke).toHaveBeenLastCalledWith("project_add", { path: "/tmp" });
    await api.projectList();
    expect(invoke).toHaveBeenLastCalledWith("project_list");
  });

  it("workspace lifecycle", async () => {
    await api.workspaceList("p1");
    expect(invoke).toHaveBeenLastCalledWith("workspace_list", { projectId: "p1" });
    await api.workspaceList();
    expect(invoke).toHaveBeenLastCalledWith("workspace_list", { projectId: undefined });
    await api.workspaceCreate("p1", "/tmp/p1", "main", "claude");
    expect(invoke).toHaveBeenLastCalledWith("workspace_create", {
      projectId: "p1", projectPath: "/tmp/p1", branch: "main", backend: "claude", baseBranch: undefined,
    });
    await api.workspaceCreate("p1", "/tmp/p1", "feat", "claude", "develop");
    expect(invoke).toHaveBeenLastCalledWith("workspace_create", {
      projectId: "p1", projectPath: "/tmp/p1", branch: "feat", backend: "claude", baseBranch: "develop",
    });
    await api.workspaceDestroy("w1");
    expect(invoke).toHaveBeenLastCalledWith("workspace_destroy", { workspaceId: "w1" });
  });

  it("pty commands", async () => {
    await api.ptySpawn("bash", ["-l"], "/wt");
    expect(invoke).toHaveBeenLastCalledWith("pty_spawn", {
      command: "bash", args: ["-l"], cwd: "/wt", env: undefined,
    });
    await api.ptyWrite("pty1", "data");
    expect(invoke).toHaveBeenLastCalledWith("pty_write", { ptyId: "pty1", data: "data" });
    await api.ptyResize("pty1", 80, 24);
    expect(invoke).toHaveBeenLastCalledWith("pty_resize", { ptyId: "pty1", cols: 80, rows: 24 });
    await api.ptyKill("pty1");
    expect(invoke).toHaveBeenLastCalledWith("pty_kill", { ptyId: "pty1" });
  });

  it("config and messages", async () => {
    await api.configLoad("/tmp/p");
    expect(invoke).toHaveBeenLastCalledWith("config_load", { projectPath: "/tmp/p" });

    await api.messagesList("s1");
    expect(invoke).toHaveBeenLastCalledWith("messages_list", { sessionId: "s1", limit: 100, offset: 0 });
    await api.messagesList("s1", 10, 5);
    expect(invoke).toHaveBeenLastCalledWith("messages_list", { sessionId: "s1", limit: 10, offset: 5 });

    await api.messageAppend("s1", "user", "hi", "json");
    expect(invoke).toHaveBeenLastCalledWith("message_append", {
      sessionId: "s1", role: "user", content: "hi", toolCallsJson: "json",
    });
    await api.messageAppend("s1", "assistant", "hi");
    expect(invoke).toHaveBeenLastCalledWith("message_append", {
      sessionId: "s1", role: "assistant", content: "hi", toolCallsJson: undefined,
    });
  });

  it("skills and diff and git", async () => {
    await api.skillsList("/tmp");
    expect(invoke).toHaveBeenLastCalledWith("skills_list", { projectPath: "/tmp" });
    await api.skillsRun("w1", "review", { a: "b" });
    expect(invoke).toHaveBeenLastCalledWith("skills_run", {
      workspaceId: "w1", skillName: "review", vars: { a: "b" },
    });
    await api.diffGet("/wt");
    expect(invoke).toHaveBeenLastCalledWith("diff_get", { worktreePath: "/wt", filePath: undefined, staged: undefined });
    await api.diffGet("/wt", "f.ts");
    expect(invoke).toHaveBeenLastCalledWith("diff_get", { worktreePath: "/wt", filePath: "f.ts", staged: undefined });
    await api.diffGet("/wt", undefined, true);
    expect(invoke).toHaveBeenLastCalledWith("diff_get", { worktreePath: "/wt", filePath: undefined, staged: true });
    await api.diffStageHunk("/wt", "patch");
    expect(invoke).toHaveBeenLastCalledWith("diff_stage_hunk", { worktreePath: "/wt", patch: "patch" });
    await api.diffUnstageHunk("/wt", "patch");
    expect(invoke).toHaveBeenLastCalledWith("diff_unstage_hunk", { worktreePath: "/wt", patch: "patch" });
    await api.gitLog("/wt");
    expect(invoke).toHaveBeenLastCalledWith("git_log", { worktreePath: "/wt", limit: 50 });
    await api.gitLog("/wt", 5);
    expect(invoke).toHaveBeenLastCalledWith("git_log", { worktreePath: "/wt", limit: 5 });
    await api.gitStashList("/wt");
    expect(invoke).toHaveBeenLastCalledWith("git_stash_list", { worktreePath: "/wt" });
    await api.gitCommit("/wt", "msg");
    expect(invoke).toHaveBeenLastCalledWith("git_commit", { worktreePath: "/wt", message: "msg", files: undefined });
    await api.gitCommit("/wt", "msg", ["a"]);
    expect(invoke).toHaveBeenLastCalledWith("git_commit", { worktreePath: "/wt", message: "msg", files: ["a"] });
    await api.fileTree("/wt");
    expect(invoke).toHaveBeenLastCalledWith("file_tree", { worktreePath: "/wt" });
  });

  it("file read / search and fs watch wrappers", async () => {
    await api.fileRead("/wt/a.md");
    expect(invoke).toHaveBeenLastCalledWith("file_read", { filePath: "/wt/a.md" });
    await api.fileSearch("/wt", "query");
    expect(invoke).toHaveBeenLastCalledWith("file_search", {
      worktreePath: "/wt", query: "query", limit: undefined,
    });
    await api.fileSearch("/wt", "query", 50);
    expect(invoke).toHaveBeenLastCalledWith("file_search", {
      worktreePath: "/wt", query: "query", limit: 50,
    });
    await api.fsWatchStart("/wt", ["/wt/src"]);
    expect(invoke).toHaveBeenLastCalledWith("fs_watch_start", { root: "/wt", dirs: ["/wt/src"] });
    await api.fsWatchStart("/wt");
    expect(invoke).toHaveBeenLastCalledWith("fs_watch_start", { root: "/wt", dirs: undefined });
    await api.fsWatchAdd(["/wt/lib"]);
    expect(invoke).toHaveBeenLastCalledWith("fs_watch_add", { dirs: ["/wt/lib"] });
    await api.fsWatchRemove(["/wt/lib"]);
    expect(invoke).toHaveBeenLastCalledWith("fs_watch_remove", { dirs: ["/wt/lib"] });
    await api.fsWatchStop();
    expect(invoke).toHaveBeenLastCalledWith("fs_watch_stop");
  });

  it("kanban / presets / mcp / misc", async () => {
    await api.kanbanList("p1");
    expect(invoke).toHaveBeenLastCalledWith("kanban_list", { projectId: "p1" });
    await api.kanbanUpsert({ id: "t1" });
    expect(invoke).toHaveBeenLastCalledWith("kanban_upsert", { task: { id: "t1" } });
    await api.presetList();
    expect(invoke).toHaveBeenLastCalledWith("preset_list", { projectPath: undefined });
    await api.presetList("/p");
    expect(invoke).toHaveBeenLastCalledWith("preset_list", { projectPath: "/p" });
    const layout = { type: "terminal" as const, agent: "a", cwd: "/", mode: "agent" as const };
    await api.presetLaunch({ name: "x", layout }, "/p1");
    expect(invoke).toHaveBeenLastCalledWith("preset_launch", {
      preset: { name: "x", layout }, projectPath: "/p1", branch: undefined,
    });
    await api.presetSaveCurrent("w1", "n");
    expect(invoke).toHaveBeenLastCalledWith("preset_save_current", { workspaceId: "w1", name: "n" });

    await api.mcpStart("fs");
    expect(invoke).toHaveBeenLastCalledWith("mcp_start", { name: "fs" });
    await api.mcpStop("fs");
    expect(invoke).toHaveBeenLastCalledWith("mcp_stop", { name: "fs" });
    await api.mcpList();
    expect(invoke).toHaveBeenLastCalledWith("mcp_list");
    await api.mcpLogs("fs");
    expect(invoke).toHaveBeenLastCalledWith("mcp_logs", { name: "fs", sinceOffset: 0 });
    await api.mcpLogs("fs", 42);
    expect(invoke).toHaveBeenLastCalledWith("mcp_logs", { name: "fs", sinceOffset: 42 });
    await api.mcpAdd("fs", "npx", ["-y"], { K: "V" }, "w1", "/p");
    expect(invoke).toHaveBeenLastCalledWith("mcp_add", {
      name: "fs", command: "npx", args: ["-y"], env: { K: "V" }, workspaceId: "w1", projectPath: "/p",
    });
    await api.configSave("/p", { automations: [] });
    expect(invoke).toHaveBeenLastCalledWith("config_save", { projectPath: "/p", patch: { automations: [] } });
    await api.contextUsage("s1");
    expect(invoke).toHaveBeenLastCalledWith("context_usage", { sessionId: "s1" });
    await api.contextRecord("s1", 1234, 0.05);
    expect(invoke).toHaveBeenLastCalledWith("context_record", {
      sessionId: "s1", tokensUsed: 1234, costEstimate: 0.05,
    });
    await api.attachmentCreate("/wt", "txt");
    expect(invoke).toHaveBeenLastCalledWith("attachment_create", { worktreePath: "/wt", text: "txt" });
    await api.automationRun("build", "w1");
    expect(invoke).toHaveBeenLastCalledWith("automation_run", { automationName: "build", workspaceId: "w1" });
    await api.notifySend("t", "b", "w1", "agent.complete");
    expect(invoke).toHaveBeenLastCalledWith("notify_send", {
      title: "t", body: "b", workspaceId: "w1", type: "agent.complete",
    });
    await api.notifySend("t", "b");
    expect(invoke).toHaveBeenLastCalledWith("notify_send", {
      title: "t", body: "b", workspaceId: undefined, type: undefined,
    });

    await api.notifyList();
    expect(invoke).toHaveBeenLastCalledWith("notify_list", { limit: undefined, unreadOnly: undefined });
    await api.notifyList(10, true);
    expect(invoke).toHaveBeenLastCalledWith("notify_list", { limit: 10, unreadOnly: true });
    await api.notifyMarkRead("n1");
    expect(invoke).toHaveBeenLastCalledWith("notify_mark_read", { id: "n1" });
    await api.notifyMarkAllRead();
    expect(invoke).toHaveBeenLastCalledWith("notify_mark_all_read");
    vi.mocked(invoke).mockResolvedValueOnce({ count: 4 } as never);
    await expect(api.notifyUnreadCount()).resolves.toBe(4);

    await api.caffeinateStart();
    expect(invoke).toHaveBeenLastCalledWith("caffeinate_start");
    await api.caffeinateStop();
    expect(invoke).toHaveBeenLastCalledWith("caffeinate_stop");
    await api.caffeinateStatus();
    expect(invoke).toHaveBeenLastCalledWith("caffeinate_status");

    await api.instructionsResolve("/wt");
    expect(invoke).toHaveBeenLastCalledWith("instructions_resolve", { worktreePath: "/wt" });

    await api.prCreate("/wt");
    expect(invoke).toHaveBeenLastCalledWith("pr_create", {
      worktreePath: "/wt", title: undefined, body: undefined, base: undefined,
    });
    await api.prCreate("/wt", "T", "B", "main");
    expect(invoke).toHaveBeenLastCalledWith("pr_create", {
      worktreePath: "/wt", title: "T", body: "B", base: "main",
    });

    await api.browserOpen("https://x.dev", { x: 1, y: 2, width: 300, height: 400 });
    expect(invoke).toHaveBeenLastCalledWith("browser_open", {
      url: "https://x.dev", x: 1, y: 2, width: 300, height: 400,
    });
    await api.browserNavigate("https://y.dev");
    expect(invoke).toHaveBeenLastCalledWith("browser_navigate", { url: "https://y.dev" });
    await api.browserSetBounds({ x: 5, y: 6, width: 7, height: 8 });
    expect(invoke).toHaveBeenLastCalledWith("browser_set_bounds", { x: 5, y: 6, width: 7, height: 8 });
    await api.browserShow();
    expect(invoke).toHaveBeenLastCalledWith("browser_show");
    await api.browserHide();
    expect(invoke).toHaveBeenLastCalledWith("browser_hide");
    await api.browserClose();
    expect(invoke).toHaveBeenLastCalledWith("browser_close");
    await api.browserEval("location.reload()");
    expect(invoke).toHaveBeenLastCalledWith("browser_eval", { script: "location.reload()" });
  });

  it("new git command wrappers (P1-A + P1-B)", async () => {
    await api.gitBranches("/p");
    expect(invoke).toHaveBeenLastCalledWith("git_branches", { projectPath: "/p" });
    await api.gitDiffStat("/wt");
    expect(invoke).toHaveBeenLastCalledWith("git_diff_stat", { worktreePath: "/wt" });

    await api.gitBranchList("/wt");
    expect(invoke).toHaveBeenLastCalledWith("git_branch_list", { worktreePath: "/wt" });
    await api.gitCheckout("/wt", "feat");
    expect(invoke).toHaveBeenLastCalledWith("git_checkout", { worktreePath: "/wt", branch: "feat" });
    await api.gitBlame("/wt", "f.ts");
    expect(invoke).toHaveBeenLastCalledWith("git_blame", { worktreePath: "/wt", filePath: "f.ts" });
    await api.gitCherryPick("/wt", "abc123");
    expect(invoke).toHaveBeenLastCalledWith("git_cherry_pick", { worktreePath: "/wt", sha: "abc123" });

    await api.gitStashApply("/wt", 0);
    expect(invoke).toHaveBeenLastCalledWith("git_stash_apply", { worktreePath: "/wt", index: 0 });
    await api.gitStashPop("/wt", 1);
    expect(invoke).toHaveBeenLastCalledWith("git_stash_pop", { worktreePath: "/wt", index: 1 });
    await api.gitStashDrop("/wt", 2);
    expect(invoke).toHaveBeenLastCalledWith("git_stash_drop", { worktreePath: "/wt", index: 2 });

    await api.gitConflicts("/wt");
    expect(invoke).toHaveBeenLastCalledWith("git_conflicts", { worktreePath: "/wt" });
    await api.gitResolveConflict("/wt", "f.ts", 0, "ours");
    expect(invoke).toHaveBeenLastCalledWith("git_resolve_conflict", {
      worktreePath: "/wt", filePath: "f.ts", hunkIndex: 0, resolution: "ours",
    });

    await api.gitFetch("/wt");
    expect(invoke).toHaveBeenLastCalledWith("git_fetch", { worktreePath: "/wt", remote: undefined });
    await api.gitFetch("/wt", "origin");
    expect(invoke).toHaveBeenLastCalledWith("git_fetch", { worktreePath: "/wt", remote: "origin" });
    await api.gitPull("/wt");
    expect(invoke).toHaveBeenLastCalledWith("git_pull", { worktreePath: "/wt" });
    await api.gitPush("/wt");
    expect(invoke).toHaveBeenLastCalledWith("git_push", { worktreePath: "/wt", remote: undefined, branch: undefined });
    await api.gitPush("/wt", "origin", "feat");
    expect(invoke).toHaveBeenLastCalledWith("git_push", { worktreePath: "/wt", remote: "origin", branch: "feat" });
  });

  it("event subscriptions register handlers and forward payloads", async () => {
    const captured: Record<string, (e: { payload: unknown }) => void> = {};
    vi.mocked(listen).mockImplementation((async (event: string, cb: (e: { payload: unknown }) => void) => {
      captured[event] = cb;
      return () => {};
    }) as unknown as typeof listen);

    const dataCb = vi.fn();
    await api.onPtyData(dataCb);
    captured["pty:data"]({ payload: { ptyId: "1", data: "x" } });
    expect(dataCb).toHaveBeenCalledWith({ ptyId: "1", data: "x" });

    const exitCb = vi.fn();
    await api.onPtyExit(exitCb);
    captured["pty:exit"]({ payload: { ptyId: "1", code: 0 } });
    expect(exitCb).toHaveBeenCalledWith({ ptyId: "1", code: 0 });

    const statusCb = vi.fn();
    await api.onWorkspaceStatus(statusCb);
    captured["workspace:status"]({ payload: { workspaceId: "w", status: "active" } });
    expect(statusCb).toHaveBeenCalledWith({ workspaceId: "w", status: "active" });

    const mcpStatusCb = vi.fn();
    await api.onMcpStatus(mcpStatusCb);
    captured["mcp:status"]({
      payload: { name: "fs", status: "restarting", restarts: 1, exitCode: 1 },
    });
    expect(mcpStatusCb).toHaveBeenCalledWith({
      name: "fs", status: "restarting", restarts: 1, exitCode: 1,
    });

    const fsChangedCb = vi.fn();
    await api.onFsChanged(fsChangedCb);
    captured["fs:changed"]({ payload: { root: "/wt", paths: ["/wt/a.ts"] } });
    expect(fsChangedCb).toHaveBeenCalledWith({ root: "/wt", paths: ["/wt/a.ts"] });
  });
});
