import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUpdater } from "./useUpdater";

const mockCheck = vi.mocked(check);
const mockRelaunch = vi.mocked(relaunch);

function fakeUpdate(overrides: Partial<Update> = {}): Update {
  return {
    version: "9.9.9",
    currentVersion: "0.0.0",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Update;
}

describe("useUpdater", () => {
  beforeEach(() => {
    mockCheck.mockReset();
    mockRelaunch.mockReset();
    mockRelaunch.mockResolvedValue(undefined);
  });

  it("starts idle", () => {
    const { result } = renderHook(() => useUpdater());
    expect(result.current.status).toBe("idle");
    expect(result.current.update).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("checkNow resolves to up-to-date when check returns null", async () => {
    mockCheck.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.checkNow();
    });
    expect(result.current.status).toBe("uptodate");
  });

  it("checkNow surfaces an available update", async () => {
    mockCheck.mockResolvedValue(fakeUpdate({ version: "1.5.0" }));
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.checkNow();
    });
    expect(result.current.status).toBe("available");
    expect(result.current.update?.version).toBe("1.5.0");
  });

  it("checkNow maps a missing-endpoint error to the unconfigured state", async () => {
    mockCheck.mockRejectedValue(new Error("updater: no endpoints configured"));
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.checkNow();
    });
    expect(result.current.status).toBe("unconfigured");
    expect(result.current.error).toBeNull();
  });

  it("checkNow maps a 404 / not-found manifest to the unconfigured state", async () => {
    mockCheck.mockRejectedValue(new Error("Could not fetch a valid release JSON: 404 Not Found"));
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.checkNow();
    });
    expect(result.current.status).toBe("unconfigured");
    expect(result.current.error).toBeNull();
  });

  it("checkNow surfaces a genuine failure as an error with its message", async () => {
    mockCheck.mockRejectedValue(new Error("network unreachable"));
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.checkNow();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("network unreachable");
  });

  it("checkNow handles a thrown string and a non-error value", async () => {
    mockCheck.mockRejectedValueOnce("disabled in the updater config");
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.checkNow();
    });
    expect(result.current.status).toBe("unconfigured");

    mockCheck.mockRejectedValueOnce(42);
    await act(async () => {
      await result.current.checkNow();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Unknown updater error");
  });

  it("installAndRestart downloads, installs and relaunches", async () => {
    const update = fakeUpdate();
    mockCheck.mockResolvedValue(update);
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.checkNow();
    });
    await act(async () => {
      await result.current.installAndRestart();
    });
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(mockRelaunch).toHaveBeenCalledOnce();
  });

  it("installAndRestart surfaces install failures as an error", async () => {
    const update = fakeUpdate({
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    mockCheck.mockResolvedValue(update);
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.checkNow();
    });
    await act(async () => {
      await result.current.installAndRestart();
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("disk full");
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it("installAndRestart is a no-op when no update is pending", async () => {
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.installAndRestart();
    });
    expect(result.current.status).toBe("idle");
    expect(mockRelaunch).not.toHaveBeenCalled();
  });
});
