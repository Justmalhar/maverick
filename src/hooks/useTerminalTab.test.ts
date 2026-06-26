import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkbench } from "@/state/store";
import { useSettingsStore } from "@/lib/stores/settings";

vi.mock("@/lib/tauri", () => ({
  ptySpawn: vi.fn(async () => ({ ptyId: "pty-xyz" })),
  ptyKill: vi.fn(async () => undefined),
}));

import * as tauri from "@/lib/tauri";
import { useTerminalTab } from "./useTerminalTab";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(tauri.ptySpawn).mockReset().mockResolvedValue({ ptyId: "pty-xyz" });
  vi.mocked(tauri.ptyKill).mockReset().mockResolvedValue(undefined);
  useWorkbench.setState({ ...initial, terminalTabs: [], activeTerminalTabId: null });
  useSettingsStore.setState({ values: {} });
});

describe("useTerminalTab", () => {
  it("open spawns the platform-default shell, adds a tab, and activates it", async () => {
    // jsdom is detected as non-Windows, so the default resolves to login zsh.
    const { result } = renderHook(() => useTerminalTab());
    let tabId = "";
    await act(async () => {
      const tab = await result.current.open("/Users/me/Desktop");
      tabId = tab.id;
    });

    expect(tauri.ptySpawn).toHaveBeenCalledWith("/bin/zsh", ["-l"], "/Users/me/Desktop", {});

    const state = useWorkbench.getState();
    expect(state.terminalTabs).toHaveLength(1);
    expect(state.terminalTabs[0].cwd).toBe("/Users/me/Desktop");
    expect(state.terminalTabs[0].title).toBe("Desktop");
    expect(state.terminalTabs[0].ptyId).toBe("pty-xyz");
    expect(state.activeTerminalTabId).toBe(tabId);
  });

  it("derives the tab title from a Windows backslash path (not the full path)", async () => {
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.open("C:\\Users\\me\\my-proj");
    });
    expect(useWorkbench.getState().terminalTabs[0].title).toBe("my-proj");
  });

  it.each([
    ["powershell", "powershell.exe", ["-NoLogo"]],
    ["cmd", "cmd.exe", []],
    ["wsl", "wsl.exe", []],
  ] as const)("open with kind %s spawns %s", async (kind, shell, args) => {
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.open("/work", kind);
    });
    expect(tauri.ptySpawn).toHaveBeenCalledWith(shell, args, "/work", {});
  });

  it("uses the persisted default shell kind when no kind is passed", async () => {
    useSettingsStore.setState({ values: { "terminal.defaultShell": "cmd" } });
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.open("/work");
    });
    expect(tauri.ptySpawn).toHaveBeenCalledWith("cmd.exe", [], "/work", {});
  });

  it("forwards the persisted global env to the spawn", async () => {
    useSettingsStore.setState({
      values: { "general.env": JSON.stringify({ FOO: "bar" }) },
    });
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.open("/work");
    });
    expect(tauri.ptySpawn).toHaveBeenCalledWith("/bin/zsh", ["-l"], "/work", { FOO: "bar" });
  });

  it("adds the tab optimistically (empty ptyId) before the spawn resolves, then binds it", async () => {
    let resolveSpawn!: (v: { ptyId: string }) => void;
    vi.mocked(tauri.ptySpawn).mockReturnValueOnce(
      new Promise((res) => {
        resolveSpawn = res;
      }),
    );
    const { result } = renderHook(() => useTerminalTab());
    let openPromise!: Promise<unknown>;
    await act(async () => {
      openPromise = result.current.open("/work");
      await Promise.resolve();
    });

    const pending = useWorkbench.getState();
    expect(pending.terminalTabs).toHaveLength(1);
    expect(pending.terminalTabs[0].ptyId).toBe("");
    expect(pending.activeTerminalTabId).toBe(pending.terminalTabs[0].id);

    await act(async () => {
      resolveSpawn({ ptyId: "pty-late" });
      await openPromise;
    });
    expect(useWorkbench.getState().terminalTabs[0].ptyId).toBe("pty-late");
  });

  it("rolls back the optimistic tab and rethrows when the spawn fails", async () => {
    vi.mocked(tauri.ptySpawn).mockRejectedValueOnce(new Error("spawn boom"));
    const { result } = renderHook(() => useTerminalTab());
    let err: unknown;
    await act(async () => {
      try {
        await result.current.open("/work");
      } catch (e) {
        err = e;
      }
    });
    expect((err as Error).message).toBe("spawn boom");
    expect(useWorkbench.getState().terminalTabs).toHaveLength(0);
    expect(useWorkbench.getState().activeTerminalTabId).toBeNull();
  });

  it("close kills the PTY and removes the tab", async () => {
    useWorkbench.setState({
      terminalTabs: [{ id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" }],
      activeTerminalTabId: "t1",
    });
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.close("t1");
    });
    expect(tauri.ptyKill).toHaveBeenCalledWith("pty-1");
    expect(useWorkbench.getState().terminalTabs).toHaveLength(0);
    expect(useWorkbench.getState().activeTerminalTabId).toBeNull();
  });

  it("close swallows ptyKill rejections", async () => {
    vi.mocked(tauri.ptyKill).mockRejectedValueOnce(new Error("boom"));
    useWorkbench.setState({
      terminalTabs: [{ id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" }],
      activeTerminalTabId: "t1",
    });
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.close("t1");
    });
    expect(useWorkbench.getState().terminalTabs).toHaveLength(0);
  });

  it("close skips ptyKill for a still-pending tab (empty ptyId)", async () => {
    useWorkbench.setState({
      terminalTabs: [{ id: "t1", cwd: "/a", title: "a", ptyId: "" }],
      activeTerminalTabId: "t1",
    });
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.close("t1");
    });
    expect(tauri.ptyKill).not.toHaveBeenCalled();
    expect(useWorkbench.getState().terminalTabs).toHaveLength(0);
  });

  it("close on a non-existent id removes nothing and does not call ptyKill", async () => {
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.close("missing");
    });
    expect(tauri.ptyKill).not.toHaveBeenCalled();
  });

  it("title falls back to cwd when basename yields an empty string (root path)", async () => {
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.open("/");
    });
    expect(useWorkbench.getState().terminalTabs[0].title).toBe("/");
  });

  it("basename falls back to the full cwd when the path has no separator", async () => {
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.open("Desktop");
    });
    expect(useWorkbench.getState().terminalTabs[0].title).toBe("Desktop");
  });
});
