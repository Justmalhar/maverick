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
    await api.workspaceCreate("p1", "main", "claude");
    expect(invoke).toHaveBeenLastCalledWith("workspace_create", {
      projectId: "p1", branch: "main", backend: "claude",
    });
    await api.workspaceDestroy("w1");
    expect(invoke).toHaveBeenLastCalledWith("workspace_destroy", { workspaceId: "w1" });
  });

  it("pty commands", async () => {
    await api.ptySpawn("w1", "bash", ["-l"]);
    expect(invoke).toHaveBeenLastCalledWith("pty_spawn", {
      workspaceId: "w1", command: "bash", args: ["-l"], cwd: undefined,
    });
    await api.ptySpawn("w1", "bash", ["-l"], "/Users/me/Desktop");
    expect(invoke).toHaveBeenLastCalledWith("pty_spawn", {
      workspaceId: "w1", command: "bash", args: ["-l"], cwd: "/Users/me/Desktop",
    });
    await api.ptyWrite("pty1", "data");
    expect(invoke).toHaveBeenLastCalledWith("pty_write", { ptyId: "pty1", data: "data" });
    await api.ptyResize("pty1", 80, 24);
    expect(invoke).toHaveBeenLastCalledWith("pty_resize", { ptyId: "pty1", cols: 80, rows: 24 });
    await api.ptyKill("pty1");
    expect(invoke).toHaveBeenLastCalledWith("pty_kill", { ptyId: "pty1" });
  });

  it("defaultShell forwards to the default_shell command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("/bin/zsh" as never);
    const shell = await api.defaultShell();
    expect(invoke).toHaveBeenLastCalledWith("default_shell");
    expect(shell).toBe("/bin/zsh");
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
    expect(invoke).toHaveBeenLastCalledWith("diff_get", { worktreePath: "/wt", filePath: undefined });
    await api.diffGet("/wt", "f.ts");
    expect(invoke).toHaveBeenLastCalledWith("diff_get", { worktreePath: "/wt", filePath: "f.ts" });
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
    await api.presetLaunch({ name: "x", layout }, "p1");
    expect(invoke).toHaveBeenLastCalledWith("preset_launch", {
      preset: { name: "x", layout }, projectId: "p1", branch: undefined,
    });
    await api.presetSaveCurrent("w1", "n");
    expect(invoke).toHaveBeenLastCalledWith("preset_save_current", { workspaceId: "w1", name: "n" });

    await api.mcpStart("fs");
    expect(invoke).toHaveBeenLastCalledWith("mcp_start", { name: "fs" });
    await api.mcpStop("fs");
    expect(invoke).toHaveBeenLastCalledWith("mcp_stop", { name: "fs" });
    await api.mcpList();
    expect(invoke).toHaveBeenLastCalledWith("mcp_list");
    await api.contextUsage("s1");
    expect(invoke).toHaveBeenLastCalledWith("context_usage", { sessionId: "s1" });
    await api.attachmentCreate("/wt", "txt");
    expect(invoke).toHaveBeenLastCalledWith("attachment_create", { worktreePath: "/wt", text: "txt" });
    await api.automationRun("build", "w1");
    expect(invoke).toHaveBeenLastCalledWith("automation_run", { automationName: "build", workspaceId: "w1" });
    await api.notifySend("t", "b", "w1");
    expect(invoke).toHaveBeenLastCalledWith("notify_send", { title: "t", body: "b", workspaceId: "w1" });
    await api.notifySend("t", "b");
    expect(invoke).toHaveBeenLastCalledWith("notify_send", { title: "t", body: "b", workspaceId: undefined });
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
  });
});
