import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { usePty } from "./usePty";

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(listen).mockReset().mockResolvedValue(() => {});
});

describe("usePty", () => {
  it("no-op when ptyId is empty", async () => {
    const { result } = renderHook(() => usePty(""));
    await expect(result.current.write("x")).resolves.toBeUndefined();
    await expect(result.current.resize(10, 10)).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("forwards pty:data events to the attached handle", async () => {
    const callbacks: Record<string, (e: { payload: unknown }) => void> = {};
    vi.mocked(listen).mockImplementation((async (event: string, cb: (e: { payload: unknown }) => void) => {
      callbacks[event] = cb;
      return () => {};
    }) as unknown as typeof listen);

    const { result } = renderHook(() => usePty("p1"));
    const handle = {
      write: vi.fn(), resize: vi.fn(), setTheme: vi.fn(), focus: vi.fn(),
      dispose: vi.fn(), dimensions: { cols: 0, rows: 0 },
    };
    act(() => result.current.attach(handle));

    await Promise.resolve();
    callbacks["pty:data"]({ payload: { ptyId: "p1", data: "X" } });
    expect(handle.write).toHaveBeenCalledWith("X");

    // Wrong ptyId should be ignored.
    callbacks["pty:data"]({ payload: { ptyId: "other", data: "Y" } });
    expect(handle.write).toHaveBeenCalledTimes(1);

    callbacks["pty:exit"]({ payload: { ptyId: "p1", code: 0 } });
    expect(handle.dispose).toHaveBeenCalled();
    callbacks["pty:exit"]({ payload: { ptyId: "x", code: 0 } });
  });

  it("write and resize hit Tauri commands with the bound id", async () => {
    const { result } = renderHook(() => usePty("p1"));
    await act(async () => {
      await result.current.write("hello");
      await result.current.resize(80, 24);
    });
    expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "p1", data: "hello" });
    expect(invoke).toHaveBeenCalledWith("pty_resize", { ptyId: "p1", cols: 80, rows: 24 });
  });

  it("cleans up listeners on unmount even if rejection occurs", async () => {
    vi.mocked(listen).mockRejectedValue(new Error("fail"));
    const { unmount } = renderHook(() => usePty("p1"));
    unmount();
  });
});
