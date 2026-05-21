import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useConfig } from "./useConfig";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("useConfig", () => {
  it("returns null when no project path is provided", () => {
    const { result } = renderHook(() => useConfig(null));
    expect(result.current.config).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("loads config for a path", async () => {
    const cfg = { version: 1, backends: { default: "claude", available: [] } };
    vi.mocked(invoke).mockResolvedValueOnce(cfg as never);
    const { result } = renderHook(() => useConfig("/p"));
    await waitFor(() => expect(result.current.config).toEqual(cfg));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("captures error with Error instance", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("nope"));
    const { result } = renderHook(() => useConfig("/p"));
    await waitFor(() => expect(result.current.error).toBe("nope"));
  });

  it("captures error with non-Error value", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("string-error");
    const { result } = renderHook(() => useConfig("/p"));
    await waitFor(() => expect(result.current.error).toBe("string-error"));
  });

  it("cancels stale requests when path changes", async () => {
    let resolveFirst: ((v: unknown) => void) | undefined;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise((res) => {
        resolveFirst = res;
      })
    );
    vi.mocked(invoke).mockResolvedValueOnce({ version: 2, backends: { default: "x", available: [] } } as never);
    const { rerender, result } = renderHook((path: string) => useConfig(path), { initialProps: "/a" });
    rerender("/b");
    resolveFirst?.({ version: 99, backends: { default: "stale", available: [] } });
    await waitFor(() => expect(result.current.config?.version).toBe(2));
  });

  it("clears config when path becomes null", () => {
    const { rerender, result } = renderHook((path: string | null) => useConfig(path), {
      initialProps: "/p" as string | null,
    });
    rerender(null);
    expect(result.current.config).toBeNull();
  });
});
