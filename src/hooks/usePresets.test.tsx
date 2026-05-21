import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { usePresets } from "./usePresets";
import { makePreset } from "@/test/fixtures";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("usePresets", () => {
  it("loads presets on mount", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makePreset({ name: "p1" })] as never);
    const { result } = renderHook(() => usePresets("/p"));
    await waitFor(() => expect(result.current.presets).toHaveLength(1));
  });

  it("swallows load errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("nope"));
    const { result } = renderHook(() => usePresets("/p"));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(result.current.presets).toEqual([]);
  });

  it("launch and saveCurrentLayout invoke + update state", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never);
    const { result } = renderHook(() => usePresets());
    await waitFor(() => expect(invoke).toHaveBeenCalled());

    vi.mocked(invoke).mockResolvedValueOnce({ workspaceId: "wX" } as never);
    let res: { workspaceId: string } | undefined;
    await act(async () => {
      res = await result.current.launch(makePreset(), "p1", "main");
    });
    expect(res).toEqual({ workspaceId: "wX" });

    vi.mocked(invoke).mockResolvedValueOnce(makePreset({ name: "saved" }) as never);
    await act(async () => {
      await result.current.saveCurrentLayout("w1", "saved");
    });
    expect(result.current.presets.find((p) => p.name === "saved")).toBeDefined();
  });
});
