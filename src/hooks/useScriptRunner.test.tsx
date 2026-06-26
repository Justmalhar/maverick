import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useScriptRunner } from "./useScriptRunner";
import {
  __resetRunnersForTests,
  disposeWorkspaceRunners,
  getRunnerSnapshot,
  runnerKey,
  startRunner,
} from "@/lib/script-runner";
import { shellCommandArgs } from "@/lib/terminal-shell";

type Callback = (e: { payload: { ptyId: string; code?: number; data?: string } }) => void;

let exitCallbacks: Callback[] = [];
let dataCallbacks: Callback[] = [];

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  exitCallbacks = [];
  dataCallbacks = [];
  vi.mocked(listen).mockImplementation((async (event: string, cb: Callback) => {
    if (event === "pty:exit") exitCallbacks.push(cb);
    if (event === "pty:data") dataCallbacks.push(cb);
    return () => {};
  }) as unknown as typeof listen);
  // Reset AFTER the listen mock is wired so the registry re-installs its shared
  // listeners into the freshly-cleared callback arrays on the next subscribe.
  __resetRunnersForTests();
});

function fireExit(ptyId: string, code: number) {
  exitCallbacks.forEach((cb) => cb({ payload: { ptyId, code } }));
}
function fireData(ptyId: string, data: string) {
  dataCallbacks.forEach((cb) => cb({ payload: { ptyId, data } }));
}

describe("useScriptRunner", () => {
  it("idle → running on start; running → exited on pty:exit", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-1" } as never);
    const { result } = renderHook(() => useScriptRunner("ws-1", "/tmp", "echo hi", "run"));
    await waitFor(() => expect(exitCallbacks.length).toBeGreaterThan(0));
    expect(result.current.state).toBe("idle");
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe("running");
    await act(async () => {
      fireExit("pty-1", 0);
    });
    await waitFor(() => expect(result.current.state).toBe("exited"));
    expect(result.current.exitCode).toBe(0);
  });

  it("spawns the script through the platform shell (cmd.exe / sh)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-sh" } as never);
    const { result } = renderHook(() => useScriptRunner("ws-1", "/tmp", "bun install", "setup"));
    await waitFor(() => expect(exitCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.start();
    });
    const argv = shellCommandArgs("bun install");
    expect(invoke).toHaveBeenCalledWith(
      "pty_spawn",
      expect.objectContaining({ command: argv[0], args: argv.slice(1), cwd: "/tmp" }),
    );
  });

  it("start is a no-op when script string is empty", async () => {
    const { result } = renderHook(() => useScriptRunner("ws-1", "/tmp", "", "run"));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe("idle");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("start is a no-op when there is no workspace", async () => {
    const { result } = renderHook(() => useScriptRunner(null, "/tmp", "echo hi", "run"));
    await act(async () => {
      await result.current.start();
      await result.current.stop();
    });
    expect(result.current.state).toBe("idle");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does NOT spawn a second process while one is already running", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-dev" } as never);
    const { result } = renderHook(() => useScriptRunner("ws-1", "/tmp", "bun run dev", "run"));
    await waitFor(() => expect(exitCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe("running");
    const spawnCalls = () =>
      vi.mocked(invoke).mock.calls.filter((c) => c[0] === "pty_spawn").length;
    expect(spawnCalls()).toBe(1);
    await act(async () => {
      await result.current.start();
    });
    expect(spawnCalls()).toBe(1);
  });

  it("stop calls pty_kill, returns to idle, and is idempotent", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ptyId: "pty-2" } as never)
      .mockResolvedValueOnce(undefined as never);
    const { result } = renderHook(() => useScriptRunner("ws-2", "/tmp", "sleep 5", "run"));
    await waitFor(() => expect(exitCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(invoke).toHaveBeenCalledWith("pty_kill", { ptyId: "pty-2" });
    expect(result.current.state).toBe("idle");
    vi.mocked(invoke).mockClear();
    await act(async () => {
      await result.current.stop();
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("a user-initiated stop preserves the captured output", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ptyId: "pty-keep" } as never)
      .mockResolvedValueOnce(undefined as never);
    const { result } = renderHook(() => useScriptRunner("ws-2", "/tmp", "bun run dev", "run"));
    await waitFor(() => expect(dataCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      fireData("pty-keep", "server listening on :3000");
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.output).toBe("server listening on :3000");
  });

  it("appends pty:data into output buffer scoped to current ptyId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-3" } as never);
    const { result } = renderHook(() => useScriptRunner("ws-3", "/tmp", "echo hi", "run"));
    await waitFor(() => expect(dataCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      fireData("pty-3", "hello ");
      fireData("pty-3", "world");
      fireData("other", "IGNORED");
    });
    await waitFor(() => expect(result.current.output).toBe("hello world"));
  });

  it("keeps the live process and its logs across an unmount/remount", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-alive" } as never);
    const first = renderHook(() => useScriptRunner("ws-9", "/tmp", "bun run dev", "run"));
    await waitFor(() => expect(dataCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await first.result.current.start();
    });
    await act(async () => {
      fireData("pty-alive", "compiled successfully");
    });
    // Simulate the bottom panel collapsing / tab switching away.
    first.unmount();
    // Process keeps streaming while nobody is mounted.
    await act(async () => {
      fireData("pty-alive", " — listening :3000");
    });
    // Panel comes back.
    const second = renderHook(() => useScriptRunner("ws-9", "/tmp", "bun run dev", "run"));
    await waitFor(() => expect(second.result.current.state).toBe("running"));
    expect(second.result.current.output).toBe("compiled successfully — listening :3000");
  });

  it("setup and run for the same workspace are independent runners", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ptyId: "pty-setup" } as never)
      .mockResolvedValueOnce({ ptyId: "pty-run" } as never);
    const setup = renderHook(() => useScriptRunner("ws-5", "/tmp", "bun install", "setup"));
    const run = renderHook(() => useScriptRunner("ws-5", "/tmp", "bun run dev", "run"));
    await waitFor(() => expect(dataCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await setup.result.current.start();
      await run.result.current.start();
    });
    await act(async () => {
      fireData("pty-setup", "installing");
      fireData("pty-run", "serving");
    });
    expect(setup.result.current.output).toBe("installing");
    expect(run.result.current.output).toBe("serving");
  });

  it("startRunner is a no-op for a blank script", async () => {
    const key = runnerKey("ws-blank", "run");
    await startRunner(key, "   ", "/tmp");
    expect(invoke).not.toHaveBeenCalled();
    expect(getRunnerSnapshot(key).state).toBe("idle");
  });

  it("spawns with an undefined cwd when none is provided", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-nocwd" } as never);
    const { result } = renderHook(() => useScriptRunner("ws-8", null, "echo hi", "run"));
    await waitFor(() => expect(exitCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.start();
    });
    expect(invoke).toHaveBeenCalledWith(
      "pty_spawn",
      expect.objectContaining({ cwd: undefined }),
    );
  });

  it("caps the output buffer at 256KiB, keeping the tail", async () => {
    const cap = 256 * 1024;
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-big" } as never);
    const { result } = renderHook(() => useScriptRunner("ws-10", "/tmp", "noisy", "run"));
    await waitFor(() => expect(dataCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      fireData("pty-big", "A".repeat(cap));
      fireData("pty-big", "B".repeat(10));
    });
    await waitFor(() => expect(result.current.output.length).toBe(cap));
    expect(result.current.output.endsWith("B".repeat(10))).toBe(true);
  });

  it("disposeWorkspaceRunners kills a live process and drops the runners", async () => {
    vi.mocked(invoke).mockResolvedValue({ ptyId: "pty-disp" } as never);
    const key = runnerKey("ws-close", "run");
    const { result } = renderHook(() => useScriptRunner("ws-close", "/tmp", "bun run dev", "run"));
    await waitFor(() => expect(exitCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.start();
    });
    expect(getRunnerSnapshot(key).state).toBe("running");
    vi.mocked(invoke).mockClear();
    disposeWorkspaceRunners("ws-close");
    expect(invoke).toHaveBeenCalledWith("pty_kill", { ptyId: "pty-disp" });
    expect(getRunnerSnapshot(key).state).toBe("idle");
  });

  it("disposeWorkspaceRunners drops an idle runner without killing a process", () => {
    const key = runnerKey("ws-idle", "setup");
    // Create an idle runner entry via subscription, then dispose.
    const { unmount } = renderHook(() => useScriptRunner("ws-idle", "/tmp", "bun install", "setup"));
    unmount();
    disposeWorkspaceRunners("ws-idle");
    expect(invoke).not.toHaveBeenCalled();
    expect(getRunnerSnapshot(key).state).toBe("idle");
  });

  it("disposeWorkspaceRunners is a no-op for a workspace with no runners", () => {
    disposeWorkspaceRunners("never-seen");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("ignores a pty:exit whose id is not the runner's current process", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-cur" } as never);
    const { result } = renderHook(() => useScriptRunner("ws-7", "/tmp", "echo hi", "run"));
    await waitFor(() => expect(exitCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      fireExit("stale-pty", 1);
    });
    expect(result.current.state).toBe("running");
  });
});
