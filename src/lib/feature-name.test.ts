import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resolveFeatureName } from "./feature-name";
import { useSettingsStore, _resetSettingsStoreForTests } from "@/lib/stores/settings";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  _resetSettingsStoreForTests();
});

describe("resolveFeatureName", () => {
  it("uses the AI name when aiBranchNames is on (the default)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ name: "login-auth-fix" } as never);
    expect(await resolveFeatureName("Fix login", "Fix the login bug", "/p")).toBe("login-auth-fix");
    expect(invoke).toHaveBeenCalledWith("ai_branch_name", { prompt: "Fix the login bug", cwd: "/p" });
  });

  it("falls back to the title when the AI returns an empty name", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ name: "   " } as never);
    expect(await resolveFeatureName("Fix login", "prompt")).toBe("Fix login");
  });

  it("falls back to the title when the AI call errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("not logged in"));
    expect(await resolveFeatureName("Fix login", "prompt")).toBe("Fix login");
  });

  it("skips the AI call and returns the title when disabled", async () => {
    useSettingsStore.setState({ values: { "general.aiBranchNames": false } });
    expect(await resolveFeatureName("Fix login", "prompt")).toBe("Fix login");
    expect(invoke).not.toHaveBeenCalled();
  });
});
