import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkbench } from "@/state/store";

vi.mock("@/lib/tauri", () => ({
  ptySpawn: vi.fn(async () => ({ ptyId: "pty-xyz" })),
  ptyKill: vi.fn(async () => undefined),
  defaultShell: vi.fn(async () => "/bin/zsh"),
}));

import * as tauri from "@/lib/tauri";
import { useTerminalTab } from "./useTerminalTab";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(tauri.ptySpawn).mockClear();
  vi.mocked(tauri.ptyKill).mockClear();
  vi.mocked(tauri.defaultShell).mockClear();
  useWorkbench.setState({ ...initial, terminalTabs: [], activeTerminalTabId: null });
});

describe("useTerminalTab", () => {
  it("open spawns a PTY at the given cwd, adds a tab, and activates it", async () => {
    const { result } = renderHook(() => useTerminalTab());
    let tabId = "";
    await act(async () => {
      const tab = await result.current.open("/Users/me/Desktop");
      tabId = tab.id;
    });

    expect(tauri.defaultShell).toHaveBeenCalled();
    expect(tauri.ptySpawn).toHaveBeenCalledWith(tabId, "/bin/zsh", ["-l"], "/Users/me/Desktop");

    const state = useWorkbench.getState();
    expect(state.terminalTabs).toHaveLength(1);
    expect(state.terminalTabs[0].cwd).toBe("/Users/me/Desktop");
    expect(state.terminalTabs[0].title).toBe("Desktop");
    expect(state.terminalTabs[0].ptyId).toBe("pty-xyz");
    expect(state.activeTerminalTabId).toBe(tabId);
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

  it("close on a non-existent id removes nothing and does not call ptyKill", async () => {
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.close("missing");
    });
    expect(tauri.ptyKill).not.toHaveBeenCalled();
  });

  it("basename falls back to the full cwd when the path has no separator", async () => {
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.open("Desktop");
    });
    expect(useWorkbench.getState().terminalTabs[0].title).toBe("Desktop");
  });

  it("title falls back to cwd when basename yields an empty string (root path)", async () => {
    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.open("/");
    });
    expect(useWorkbench.getState().terminalTabs[0].title).toBe("/");
  });
});
