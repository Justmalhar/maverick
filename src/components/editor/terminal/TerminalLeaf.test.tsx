import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { TerminalLeaf, killLeaf, killWorkspaceLeaves, __testing__ } from "./TerminalLeaf";
import { makeWorkspace } from "@/test/fixtures";
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
});

describe("TerminalLeaf", () => {
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
