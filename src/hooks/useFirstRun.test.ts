import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useFirstRun } from "./useFirstRun";
import type { BootstrapStatus } from "@/lib/ipc";

const baseStatus: BootstrapStatus = {
  ok: true,
  error: null,
  firstRun: true,
  wizardVersion: 0,
  currentWizardVersion: 1,
  paths: { configRoot: "/h/.maverick", dbPath: "/d/db.sqlite", logsDir: "/d/logs" },
  settings: {
    schemaVersion: 1,
    wizardVersion: 0,
    firstRunCompletedAt: null,
    theme: "maverick-dark",
    defaultBackend: null,
    notificationsRequestedAt: null,
  },
  notificationPermission: "default",
};

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useFirstRun", () => {
  it("opens when firstRun: true", async () => {
    mockInvoke.mockResolvedValueOnce(baseStatus);
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.open).toBe(true);
  });

  it("does not open when firstRun: false", async () => {
    mockInvoke.mockResolvedValueOnce({
      ...baseStatus,
      firstRun: false,
      settings: { ...baseStatus.settings, firstRunCompletedAt: 123 },
    });
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.open).toBe(false);
  });

  it("advance() increments step", async () => {
    mockInvoke.mockResolvedValueOnce(baseStatus);
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    act(() => result.current.advance());
    expect(result.current.step).toBe(2);
  });

  it("complete() calls bootstrap_complete and closes the wizard", async () => {
    mockInvoke.mockResolvedValueOnce(baseStatus);
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    mockInvoke.mockResolvedValueOnce({ firstRunCompletedAt: 999 });
    // The complete() implementation refreshes after closing; mock the refresh too.
    mockInvoke.mockResolvedValueOnce({ ...baseStatus, firstRun: false });
    await act(async () => {
      await result.current.complete();
    });
    expect(mockInvoke).toHaveBeenCalledWith("bootstrap_complete");
    expect(result.current.open).toBe(false);
  });

  it("reset() calls reset_first_run and re-fetches status", async () => {
    mockInvoke.mockResolvedValueOnce({
      ...baseStatus,
      firstRun: false,
    });
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.open).toBe(false);

    mockInvoke.mockResolvedValueOnce(undefined); // reset_first_run
    mockInvoke.mockResolvedValueOnce(baseStatus); // re-fetched status

    await act(async () => {
      await result.current.reset();
    });
    expect(mockInvoke).toHaveBeenCalledWith("reset_first_run");
    expect(result.current.open).toBe(true);
  });

  it("back() decrements step but not below 1", async () => {
    mockInvoke.mockResolvedValueOnce(baseStatus);
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    act(() => result.current.advance()); // step 1 → 2
    act(() => result.current.back()); // step 2 → 1
    expect(result.current.step).toBe(1);
    act(() => result.current.back()); // clamps at 1
    expect(result.current.step).toBe(1);
  });

  it("goTo() jumps to the requested step", async () => {
    mockInvoke.mockResolvedValueOnce(baseStatus);
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    act(() => result.current.goTo(3));
    expect(result.current.step).toBe(3);
  });

  it("advance() clamps at step 4 (final step)", async () => {
    mockInvoke.mockResolvedValueOnce(baseStatus);
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    act(() => result.current.goTo(4));
    act(() => result.current.advance()); // stays at 4
    expect(result.current.step).toBe(4);
  });
});
