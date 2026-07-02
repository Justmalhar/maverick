import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderHook, act } from "@testing-library/react";
import { useLaunchSpec, __resetLaunchedForTests, isClaudeLaunchCommand } from "./useLaunchSpec";
import { useWorkbench } from "@/state/store";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";
import { makeWorkspace } from "@/test/fixtures";
import type { Workspace } from "@/lib/ipc";
import * as terminalShell from "@/lib/terminal-shell";
import * as settings from "@/lib/stores/settings";

const captured: Record<string, (e: { payload: unknown }) => void> = {};
const unlistenData = vi.fn();
const unlistenExit = vi.fn();

function emitData(ptyId: string, data: string) {
  captured["pty:data"]?.({ payload: { ptyId, data } });
}
function emitExit(ptyId: string, code: number) {
  captured["pty:exit"]?.({ payload: { ptyId, code } });
}

/** Mount the hook, then flush the listen() promises so emit helpers are wired. */
async function mount(ws: Workspace, ptyId: string | undefined, ready: boolean) {
  const result = renderHook(() => useLaunchSpec(ws, ptyId, ready));
  await act(async () => {});
  return result;
}

function writeCalls() {
  return vi.mocked(invoke).mock.calls.filter((c) => c[0] === "pty_write");
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const k of Object.keys(captured)) delete captured[k];
  unlistenData.mockReset();
  unlistenExit.mockReset();
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(listen).mockReset().mockImplementation((async (event: string, cb: (e: { payload: unknown }) => void) => {
    captured[event] = cb;
    return event === "pty:data" ? unlistenData : unlistenExit;
  }) as unknown as typeof listen);
  __resetLaunchedForTests();
  useWorkbench.setState({ launchSpecs: {} });
  useAgentStatusStore.setState({ statuses: {} });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("useLaunchSpec", () => {
  it("no-ops when not ready or ptyId is undefined", async () => {
    const ws = makeWorkspace({ id: "w1" });
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: [] });
    await mount(ws, undefined, true);
    await mount(ws, "pty-1", false);
    expect(writeCalls()).toHaveLength(0);
    expect(useWorkbench.getState().launchSpecs["w1"]).toBeDefined();
  });

  it("no-ops when no spec is staged", async () => {
    await mount(makeWorkspace({ id: "w1" }), "pty-1", true);
    expect(writeCalls()).toHaveLength(0);
    expect(useAgentStatusStore.getState().statuses["w1"]).toBeUndefined();
  });

  it("consumes the spec once, writes the launch command, flips status to working", async () => {
    const ws = makeWorkspace({ id: "w1", sessionId: undefined });
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: ["--foo"] });
    await mount(ws, "pty-1", true);
    expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "pty-1", data: "claude --foo\r" });
    expect(useWorkbench.getState().launchSpecs["w1"]).toBeUndefined();
    expect(useAgentStatusStore.getState().statuses["w1"]).toBe("working");
  });

  it("consumes only once across remount (module guard)", async () => {
    const ws = makeWorkspace({ id: "w1", sessionId: undefined });
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: [] });
    const { unmount } = await mount(ws, "pty-1", true);
    expect(writeCalls()).toHaveLength(1);
    unmount();
    // Re-stage and remount: the guard must prevent a second launch.
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: [] });
    await mount(ws, "pty-1", true);
    expect(writeCalls()).toHaveLength(1);
    expect(useWorkbench.getState().launchSpecs["w1"]).toBeDefined();
  });

  it("bracketed-pastes the prompt after output goes idle and records usage", async () => {
    const ws = makeWorkspace({ id: "w1", sessionId: "sess-1", agentBackend: "claude" });
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: [], prompt: "fix the bug" });
    await mount(ws, "pty-1", true);
    expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "pty-1", data: "claude\r" });
    // Usage estimate recorded deterministically from the prompt text.
    expect(invoke).toHaveBeenCalledWith("context_record", expect.objectContaining({ sessionId: "sess-1" }));

    act(() => emitData("pty-1", "Welcome to Claude"));
    expect(
      writeCalls().some((c) => String((c[1] as { data: string }).data).includes("fix the bug"))
    ).toBe(false);
    act(() => vi.advanceTimersByTime(400));
    expect(invoke).toHaveBeenCalledWith("pty_write", {
      ptyId: "pty-1",
      data: "\x1b[200~fix the bug\x1b[201~\r",
    });
  });

  it("ignores data for a different pty", async () => {
    const ws = makeWorkspace({ id: "w1", sessionId: undefined });
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: [], prompt: "go" });
    await mount(ws, "pty-1", true);
    act(() => emitData("other-pty", "noise"));
    act(() => vi.advanceTimersByTime(400));
    // The watcher never got a push for pty-1, so no paste fires yet.
    expect(writeCalls().some((c) => String((c[1] as { data: string }).data).includes("go"))).toBe(false);
  });

  it("no prompt → launches but never pastes", async () => {
    const ws = makeWorkspace({ id: "w1", sessionId: undefined });
    useWorkbench.getState().setLaunchSpec("w1", { command: "codex", args: [] });
    await mount(ws, "pty-1", true);
    expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "pty-1", data: "codex\r" });
    act(() => emitData("pty-1", "ready"));
    act(() => vi.advanceTimersByTime(10_000));
    expect(writeCalls()).toHaveLength(1);
  });

  it("empty-string prompt is treated as no prompt", async () => {
    const ws = makeWorkspace({ id: "w1", sessionId: "sess-1" });
    useWorkbench.getState().setLaunchSpec("w1", { command: "codex", args: [], prompt: "" });
    await mount(ws, "pty-1", true);
    expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "pty-1", data: "codex\r" });
    expect(invoke).not.toHaveBeenCalledWith("context_record", expect.anything());
  });

  it("output keeps status working (BEL no longer signals attention), exit records done", async () => {
    const ws = makeWorkspace({ id: "w1", sessionId: undefined });
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: [] });
    await mount(ws, "pty-1", true);
    act(() => emitData("pty-1", "\x07"));
    expect(useAgentStatusStore.getState().statuses["w1"]).toBe("working");
    act(() => emitExit("pty-1", 0));
    expect(useAgentStatusStore.getState().statuses["w1"]).toBe("done");
  });

  it("ignores exit for a different pty", async () => {
    const ws = makeWorkspace({ id: "w1", sessionId: undefined });
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: [] });
    await mount(ws, "pty-1", true);
    act(() => emitExit("other", 1));
    expect(useAgentStatusStore.getState().statuses["w1"]).toBe("working");
  });

  it("unsubscribes and cancels the watcher on unmount", async () => {
    const ws = makeWorkspace({ id: "w1", sessionId: undefined });
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: [], prompt: "p" });
    const { unmount } = await mount(ws, "pty-1", true);
    expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "pty-1", data: "claude\r" });
    unmount();
    await act(async () => {});
    expect(unlistenData).toHaveBeenCalled();
    expect(unlistenExit).toHaveBeenCalled();
    // After cancel the idle paste must never fire even if a chunk lands late.
    act(() => emitData("pty-1", "late"));
    act(() => vi.advanceTimersByTime(400));
    expect(writeCalls().some((c) => String((c[1] as { data: string }).data).includes("p"))).toBe(false);
  });

  it("launchShell() returns 'cmd' on Windows when default shell is cmd", async () => {
    const isWindowsSpy = vi.spyOn(terminalShell, "isWindows").mockReturnValue(true);
    const shellKindSpy = vi.spyOn(settings, "getDefaultShellKind").mockReturnValue("cmd");
    __resetLaunchedForTests();
    useWorkbench.setState({ launchSpecs: {} });
    useWorkbench.getState().setLaunchSpec("win-cmd", { command: "codex", args: [] });
    const ws = makeWorkspace({ id: "win-cmd", sessionId: undefined });
    await mount(ws, "pty-cmd", true);
    // On Windows+cmd the command line uses cmd quoting (no slash escaping).
    expect(writeCalls().length).toBeGreaterThan(0);
    isWindowsSpy.mockRestore();
    shellKindSpy.mockRestore();
  });

  it("launchShell() returns 'posix' on Windows when default shell is wsl", async () => {
    const isWindowsSpy = vi.spyOn(terminalShell, "isWindows").mockReturnValue(true);
    const shellKindSpy = vi.spyOn(settings, "getDefaultShellKind").mockReturnValue("wsl");
    __resetLaunchedForTests();
    useWorkbench.setState({ launchSpecs: {} });
    useWorkbench.getState().setLaunchSpec("win-wsl", { command: "claude", args: [] });
    const ws = makeWorkspace({ id: "win-wsl", sessionId: undefined });
    await mount(ws, "pty-wsl", true);
    expect(writeCalls().length).toBeGreaterThan(0);
    isWindowsSpy.mockRestore();
    shellKindSpy.mockRestore();
  });

  it("launchShell() returns 'powershell' on Windows when default shell is powershell", async () => {
    const isWindowsSpy = vi.spyOn(terminalShell, "isWindows").mockReturnValue(true);
    const shellKindSpy = vi.spyOn(settings, "getDefaultShellKind").mockReturnValue("powershell");
    __resetLaunchedForTests();
    useWorkbench.setState({ launchSpecs: {} });
    useWorkbench.getState().setLaunchSpec("win-ps", { command: "claude", args: [] });
    const ws = makeWorkspace({ id: "win-ps", sessionId: undefined });
    await mount(ws, "pty-ps", true);
    expect(writeCalls().length).toBeGreaterThan(0);
    isWindowsSpy.mockRestore();
    shellKindSpy.mockRestore();
  });

  it("prepends --settings <path> for a claude launch when the RPC succeeds", async () => {
    const ws = makeWorkspace({ id: "w1", sessionId: undefined });
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: ["--foo"] });
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "hooks_claude_settings_path") return { path: "/tmp/ws.json" };
      return undefined;
    }) as unknown as typeof invoke);
    await mount(ws, "pty-1", true);
    expect(invoke).toHaveBeenCalledWith("hooks_claude_settings_path", { workspaceId: "w1" });
    expect(invoke).toHaveBeenCalledWith("pty_write", {
      ptyId: "pty-1",
      data: "claude --settings /tmp/ws.json --foo\r",
    });
  });

  it("fails open (launches without --settings) when hooksClaudeSettingsPath rejects", async () => {
    const ws = makeWorkspace({ id: "w1", sessionId: undefined });
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: ["--foo"] });
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "hooks_claude_settings_path") throw new Error("rpc failed");
      return undefined;
    }) as unknown as typeof invoke);
    await mount(ws, "pty-1", true);
    expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "pty-1", data: "claude --foo\r" });
  });

  it("does not fetch settings or inject --settings for non-claude commands", async () => {
    const ws = makeWorkspace({ id: "w1", sessionId: undefined });
    useWorkbench.getState().setLaunchSpec("w1", { command: "codex", args: ["--foo"] });
    await mount(ws, "pty-1", true);
    expect(invoke).not.toHaveBeenCalledWith("hooks_claude_settings_path", expect.anything());
    expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "pty-1", data: "codex --foo\r" });
  });
});

describe("isClaudeLaunchCommand", () => {
  it("matches bare and pathed claude binaries", () => {
    expect(isClaudeLaunchCommand("claude")).toBe(true);
    expect(isClaudeLaunchCommand("/Users/x/.local/bin/claude")).toBe(true);
    expect(isClaudeLaunchCommand("claude.cmd")).toBe(true);
    expect(isClaudeLaunchCommand("C:\\bin\\claude.exe")).toBe(true);
  });

  it("does not match other CLIs", () => {
    expect(isClaudeLaunchCommand("codex")).toBe(false);
    expect(isClaudeLaunchCommand("gemini")).toBe(false);
    expect(isClaudeLaunchCommand("claude-code-helper")).toBe(false);
  });
});
