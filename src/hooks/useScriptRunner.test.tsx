import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useScriptRunner } from "./useScriptRunner";

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
});

function fireExit(ptyId: string, code: number) {
  exitCallbacks.forEach((cb) => cb({ payload: { ptyId, code } }));
}

describe("useScriptRunner", () => {
  it("idle → running on start; running → exited on pty:exit", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-1" } as never);
    const { result } = renderHook(() => useScriptRunner("ws-1", "/tmp", "echo hi"));
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

  it("start is a no-op when script string is empty", async () => {
    const { result } = renderHook(() => useScriptRunner("ws-1", "/tmp", ""));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe("idle");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("stop calls pty_kill and is idempotent", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ptyId: "pty-2" } as never)
      .mockResolvedValueOnce(undefined as never);
    const { result } = renderHook(() => useScriptRunner("ws-2", "/tmp", "sleep 5"));
    await waitFor(() => expect(exitCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(invoke).toHaveBeenCalledWith("pty_kill", { ptyId: "pty-2" });
    vi.mocked(invoke).mockClear();
    await act(async () => {
      await result.current.stop();
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("appends pty:data into output buffer scoped to current ptyId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-3" } as never);
    const { result } = renderHook(() => useScriptRunner("ws-3", "/tmp", "echo hi"));
    await waitFor(() => expect(dataCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      dataCallbacks.forEach((cb) => cb({ payload: { ptyId: "pty-3", data: "hello " } }));
      dataCallbacks.forEach((cb) => cb({ payload: { ptyId: "pty-3", data: "world" } }));
      dataCallbacks.forEach((cb) => cb({ payload: { ptyId: "other", data: "IGNORED" } }));
    });
    await waitFor(() => expect(result.current.output).toBe("hello world"));
  });
});
