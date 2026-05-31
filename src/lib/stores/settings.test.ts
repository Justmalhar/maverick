import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useSettings,
  useSettingsStore,
  _resetSettingsStoreForTests,
  parseEnvMap,
  getGlobalEnv,
  useGlobalEnv,
} from "./settings";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(invoke).mockReset().mockResolvedValue({ ok: true });
  _resetSettingsStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSettings", () => {
  it("returns the default value when unset", () => {
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    expect(result.current[0]).toBe("claude");
  });

  it("updates optimistically on set", () => {
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    act(() => result.current[1]("codex"));
    expect(result.current[0]).toBe("codex");
  });

  it("debounces persist calls within 250ms", async () => {
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    act(() => {
      result.current[1]("codex");
      result.current[1]("gemini");
      result.current[1]("aider");
    });
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("settings_write", {
      key: "general.defaultBackend",
      value: "aider",
    });
  });

  it("keeps optimistic value when invoke throws (sidecar missing)", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("command not found"));
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    act(() => result.current[1]("codex"));
    expect(result.current[0]).toBe("codex");
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await waitFor(() => expect(useSettingsStore.getState().status).toBe("saved"));
    expect(result.current[0]).toBe("codex");
  });

  it("rolls back when sidecar explicitly returns ok:false", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ok: false, error: "disk full" });
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    act(() => result.current[1]("codex"));
    expect(result.current[0]).toBe("codex");
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await waitFor(() => expect(result.current[0]).toBe("claude"));
    expect(useSettingsStore.getState().status).toBe("error");
    expect(useSettingsStore.getState().lastError).toBe("disk full");
  });

  it("exposes save status transitions: idle -> saving -> saved", async () => {
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    let resolveInvoke!: (v: { ok: true }) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise((res) => { resolveInvoke = res as never; })
    );
    expect(useSettingsStore.getState().status).toBe("idle");
    act(() => result.current[1]("codex"));
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(useSettingsStore.getState().status).toBe("saving");
    await act(async () => {
      resolveInvoke({ ok: true });
      await Promise.resolve();
    });
    expect(useSettingsStore.getState().status).toBe("saved");
  });

  it("rehydrates from settings_read_all", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "settings_read_all") {
        return { "general.defaultBackend": "codex" };
      }
      return { ok: true };
    });
    await act(async () => {
      await useSettingsStore.getState().hydrate();
    });
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    expect(result.current[0]).toBe("codex");
  });

  it("hydrate resets to empty values when settings_read_all throws", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("sidecar unavailable"));
    await act(async () => {
      await useSettingsStore.getState().hydrate();
    });
    expect(useSettingsStore.getState().values).toEqual({});
  });

  it("rolls back to previous non-undefined value when sidecar returns ok:false", async () => {
    vi.mocked(invoke).mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    // Set an initial value so previous is defined
    act(() => result.current[1]("codex"));
    await act(async () => { vi.advanceTimersByTime(250); });
    await waitFor(() => expect(result.current[0]).toBe("codex"));

    // Now update again but have sidecar reject → should roll back to "codex"
    vi.mocked(invoke).mockResolvedValueOnce({ ok: false, error: "conflict" });
    act(() => result.current[1]("aider"));
    await act(async () => { vi.advanceTimersByTime(250); });
    await waitFor(() => expect(result.current[0]).toBe("codex"));
    expect(useSettingsStore.getState().status).toBe("error");
  });
});

describe("parseEnvMap", () => {
  it("returns {} for undefined, empty, and whitespace", () => {
    expect(parseEnvMap(undefined)).toEqual({});
    expect(parseEnvMap("")).toEqual({});
    expect(parseEnvMap("   ")).toEqual({});
  });

  it("returns {} for non-string scalar values", () => {
    expect(parseEnvMap(42)).toEqual({});
    expect(parseEnvMap(true)).toEqual({});
  });

  it("returns {} for malformed JSON", () => {
    expect(parseEnvMap("{not json")).toEqual({});
  });

  it("returns {} for non-object JSON (null, array, primitive)", () => {
    expect(parseEnvMap("null")).toEqual({});
    expect(parseEnvMap("[1,2]")).toEqual({});
    expect(parseEnvMap('"a string"')).toEqual({});
  });

  it("keeps only string-valued entries", () => {
    expect(parseEnvMap(JSON.stringify({ A: "1", B: 2, C: "3", D: null }))).toEqual({
      A: "1",
      C: "3",
    });
  });
});

describe("getGlobalEnv", () => {
  it("reads the parsed map from the store", () => {
    useSettingsStore.setState({ values: { "general.env": JSON.stringify({ X: "y" }) } });
    expect(getGlobalEnv()).toEqual({ X: "y" });
  });

  it("returns {} when unset", () => {
    expect(getGlobalEnv()).toEqual({});
  });
});

describe("useGlobalEnv", () => {
  it("exposes the parsed env map and persists JSON on set", async () => {
    const { result } = renderHook(() => useGlobalEnv());
    expect(result.current[0]).toEqual({});
    act(() => result.current[1]({ A: "1" }));
    expect(result.current[0]).toEqual({ A: "1" });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(invoke).toHaveBeenCalledWith("settings_write", {
      key: "general.env",
      value: JSON.stringify({ A: "1" }),
    });
  });
});
