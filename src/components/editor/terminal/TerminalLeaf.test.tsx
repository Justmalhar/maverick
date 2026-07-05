import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, waitFor, act } from "@/test/utils";
import { TerminalLeaf } from "./TerminalLeaf";
import { killLeaf, killWorkspaceLeaves, getLeafPtyId, __testing__ } from "./leaf-registry";
import { makeWorkspace } from "@/test/fixtures";
import { useWorkbench } from "@/state/store";
import { __resetLaunchedForTests } from "@/hooks/useLaunchSpec";
import { _resetSettingsStoreForTests, useSettingsStore } from "@/lib/stores/settings";
import { TerminalRegistry, type TerminalHandle, type TerminalProvider } from "@/lib/terminal-provider";

const handle: TerminalHandle = {
  write: vi.fn(), onData: vi.fn(() => () => {}), onResize: vi.fn(() => () => {}),
  resize: vi.fn(), setTheme: vi.fn(), focus: vi.fn(), dispose: vi.fn(),
  get dimensions() { return { cols: 80, rows: 24 }; },
};

const ws = makeWorkspace({ id: "w1", worktreePath: "/wt" });

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue({ ptyId: "pty-x" } as never);
  vi.mocked(listen).mockReset().mockResolvedValue(() => {});
  TerminalRegistry.register({ mount: () => handle } as TerminalProvider);
  __testing__.leafPtyCache.clear();
  __resetLaunchedForTests();
  useWorkbench.setState({ launchSpecs: {} });
  _resetSettingsStoreForTests();
});

describe("TerminalLeaf", () => {
  it("threads the global env into the shell spawn", async () => {
    useSettingsStore.setState({ values: { "general.env": JSON.stringify({ FOO: "bar" }) } });
    renderWithProviders(
      <TerminalLeaf leafId="leaf-env" workspace={ws} isFocused onFocus={() => {}} />
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ env: { FOO: "bar" } })
      )
    );
  });

  it("spawns a login shell in the worktree and renders the pane", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-1" } as never);
    renderWithProviders(
      <TerminalLeaf leafId="leaf-a" workspace={ws} isFocused onFocus={() => {}} />
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ command: "/bin/zsh", args: ["-l"], cwd: "/wt" })
      )
    );
    expect(await screen.findByTestId("terminal-pane-leaf-a")).toBeInTheDocument();
    expect(__testing__.leafPtyCache.get("leaf-a")).toBe("pty-1");
  });

  it("shows the loading state until the spawn resolves", () => {
    vi.mocked(invoke).mockImplementationOnce(() => new Promise<never>(() => {}) as never);
    renderWithProviders(
      <TerminalLeaf leafId="leaf-load" workspace={ws} isFocused onFocus={() => {}} />
    );
    expect(screen.getByTestId("terminal-leaf-loading-leaf-load")).toBeInTheDocument();
  });

  it("surfaces an error when the shell fails to start", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no shell"));
    renderWithProviders(
      <TerminalLeaf leafId="leaf-err" workspace={ws} isFocused onFocus={() => {}} />
    );
    expect(await screen.findByTestId("terminal-leaf-error-leaf-err")).toHaveTextContent("no shell");
  });

  it("reuses the cached pty without respawning (survives remount)", async () => {
    __testing__.leafPtyCache.set("leaf-cached", "pty-cached");
    renderWithProviders(
      <TerminalLeaf leafId="leaf-cached" workspace={ws} isFocused onFocus={() => {}} />
    );
    expect(await screen.findByTestId("terminal-pane-leaf-cached")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("pty_spawn", expect.anything());
  });

  it("killLeaf kills the pty and evicts the cache entry", async () => {
    __testing__.leafPtyCache.set("leaf-kill", "pty-kill");
    killLeaf("leaf-kill");
    expect(__testing__.leafPtyCache.has("leaf-kill")).toBe(false);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_kill", { ptyId: "pty-kill" })
    );
  });

  it("killLeaf is a no-op for an unknown leaf", () => {
    killLeaf("never-existed");
    expect(invoke).not.toHaveBeenCalledWith("pty_kill", expect.anything());
  });

  it("killWorkspaceLeaves kills only the matching workspace's leaves", async () => {
    __testing__.leafPtyCache.set("w1-1", "pty-1");
    __testing__.leafPtyCache.set("w1-1700000000", "pty-2");
    __testing__.leafPtyCache.set("w2-1", "pty-3");
    killWorkspaceLeaves("w1");
    expect(__testing__.leafPtyCache.has("w1-1")).toBe(false);
    expect(__testing__.leafPtyCache.has("w1-1700000000")).toBe(false);
    expect(__testing__.leafPtyCache.has("w2-1")).toBe(true);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("pty_kill", { ptyId: "pty-1" });
      expect(invoke).toHaveBeenCalledWith("pty_kill", { ptyId: "pty-2" });
    });
    expect(invoke).not.toHaveBeenCalledWith("pty_kill", { ptyId: "pty-3" });
  });

  it("ignores a late spawn result after unmount", async () => {
    let resolveSpawn!: (v: { ptyId: string }) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise<{ ptyId: string }>((res) => { resolveSpawn = res; }) as never
    );
    const { unmount } = renderWithProviders(
      <TerminalLeaf leafId="leaf-late" workspace={ws} isFocused onFocus={() => {}} />
    );
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    unmount();
    resolveSpawn({ ptyId: "late" });
    await Promise.resolve();
    expect(__testing__.leafPtyCache.has("leaf-late")).toBe(false);
  });

  it("getLeafPtyId returns the cached pty id, undefined when absent", () => {
    expect(getLeafPtyId("absent")).toBeUndefined();
    __testing__.leafPtyCache.set("present", "pty-present");
    expect(getLeafPtyId("present")).toBe("pty-present");
  });

  it("resolves the platform default shell (zsh on macOS/Linux)", async () => {
    renderWithProviders(
      <TerminalLeaf leafId="leaf-shell" workspace={ws} isFocused onFocus={() => {}} />
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ command: "/bin/zsh", args: ["-l"] })
      )
    );
  });

  it("spawns the chosen shell when terminal.defaultShell is set", async () => {
    useSettingsStore.setState({ values: { "terminal.defaultShell": "cmd" } });
    renderWithProviders(
      <TerminalLeaf leafId="leaf-cmd" workspace={ws} isFocused onFocus={() => {}} />
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ command: "cmd.exe", args: [] })
      )
    );
  });

  it("the primary leaf consumes the staged launch spec and types the command with injected --settings", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      cmd === "hooks_claude_settings_path"
        ? Promise.resolve({ path: "/tmp/hooks.json" })
        : Promise.resolve({ ptyId: "pty-primary" })) as never);
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: ["--yolo"] });
    renderWithProviders(
      <TerminalLeaf leafId="w1-1" workspace={ws} isFocused onFocus={() => {}} />
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_write",
        { ptyId: "pty-primary", data: "claude --settings /tmp/hooks.json --yolo\r" }
      )
    );
    expect(useWorkbench.getState().launchSpecs["w1"]).toBeUndefined();
  });

  it("a preset leaf spawns its own command in its cwd and types the startup line (#3)", async () => {
    vi.mocked(invoke).mockResolvedValue({ ptyId: "pty-preset" } as never);
    renderWithProviders(
      <TerminalLeaf
        leafId="w1-1"
        workspace={ws}
        isFocused
        onFocus={() => {}}
        command="claude"
        args={["--print"]}
        cwd="/wt/sub"
        startup="run tests"
      />
    );
    // Spawns the preset command + cwd (not the default shell).
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_spawn",
        expect.objectContaining({ command: "claude", args: ["--print"], cwd: "/wt/sub" })
      )
    );
    // Types the startup line into it once.
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "pty-preset", data: "run tests\r" })
    );
    // A preset leaf must NOT also consume a staged launch spec (would double-type).
    useWorkbench.getState().setLaunchSpec("w1", { command: "x", args: [] });
    expect(useWorkbench.getState().launchSpecs["w1"]).toBeDefined();
  });

  it("evicts the leaf from the cache on a natural pty exit (#40l)", async () => {
    const exitHandlers: Array<(e: { payload: { ptyId: string; code: number } }) => void> = [];
    vi.mocked(listen).mockImplementation((async (event: string, cb: unknown) => {
      if (event === "pty:exit") exitHandlers.push(cb as never);
      return () => {};
    }) as never);
    vi.mocked(invoke).mockResolvedValue({ ptyId: "pty-exit" } as never);
    renderWithProviders(
      <TerminalLeaf leafId="leaf-exit" workspace={ws} isFocused onFocus={() => {}} />
    );
    await waitFor(() => expect(__testing__.leafPtyCache.get("leaf-exit")).toBe("pty-exit"));
    // The shell exits on its own — the stale ptyId must be evicted so a later
    // remount respawns instead of binding the corpse.
    act(() => exitHandlers.forEach((h) => h({ payload: { ptyId: "pty-exit", code: 0 } })));
    expect(__testing__.leafPtyCache.has("leaf-exit")).toBe(false);
  });

  it("a non-primary leaf never consumes the launch spec", async () => {
    useWorkbench.getState().setLaunchSpec("w1", { command: "claude", args: [] });
    renderWithProviders(
      <TerminalLeaf leafId="w1-99" workspace={ws} isFocused onFocus={() => {}} />
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("pty_spawn", expect.anything()));
    expect(invoke).not.toHaveBeenCalledWith("pty_write", expect.anything());
    expect(useWorkbench.getState().launchSpecs["w1"]).toBeDefined();
  });

  it("ignores a late spawn error after unmount", async () => {
    let rejectSpawn!: (e: Error) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise<{ ptyId: string }>((_, rej) => { rejectSpawn = rej; }) as never
    );
    const { unmount } = renderWithProviders(
      <TerminalLeaf leafId="leaf-late-err" workspace={ws} isFocused onFocus={() => {}} />
    );
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    unmount();
    rejectSpawn(new Error("late"));
    await Promise.resolve();
    expect(__testing__.leafPtyCache.has("leaf-late-err")).toBe(false);
  });
});
