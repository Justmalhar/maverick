import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useSkills } from "./useSkills";
import { useWorkbench } from "@/state/store";
import { makeSkill } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, skills: [] });
});

describe("useSkills", () => {
  it("does nothing when projectPath is missing", () => {
    renderHook(() => useSkills(null));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("loads skills for a path and exposes findSkill/runSkill", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makeSkill({ name: "review" })] as never);
    const { result } = renderHook(() => useSkills("/p"));
    await waitFor(() => expect(result.current.skills).toHaveLength(1));
    expect(result.current.findSkill("review")?.name).toBe("review");
    expect(result.current.findSkill("missing")).toBeUndefined();

    vi.mocked(invoke).mockResolvedValueOnce({ prompt: "expanded" } as never);
    let prompt = "";
    await act(async () => {
      prompt = await result.current.runSkill("w1", "review", { a: "b" });
    });
    expect(prompt).toBe("expanded");
  });

  it("silently swallows sidecar errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("nope"));
    renderHook(() => useSkills("/p"));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
  });
});
