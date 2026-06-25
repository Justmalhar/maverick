import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resolveFeatureName, resolveTaskBranch } from "./feature-name";
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

describe("resolveTaskBranch", () => {
  it("with a branchRename preference, uses the AI full name verbatim", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ name: "feature/login-page" } as never);
    const branch = await resolveTaskBranch({
      title: "Fix login",
      prompt: "Fix the login page",
      cwd: "/p",
      instructions: "always use feature/feature-name",
    });
    expect(branch).toBe("feature/login-page");
    expect(invoke).toHaveBeenCalledWith("ai_branch_name", {
      prompt: "Fix the login page",
      cwd: "/p",
      instructions: "always use feature/feature-name",
    });
  });

  it("without a preference, wraps the AI feature-name in the global scheme", async () => {
    useSettingsStore.setState({ values: { "general.namingScheme": "maverick/{feature-name}" } });
    vi.mocked(invoke).mockResolvedValueOnce({ name: "login-page" } as never);
    const branch = await resolveTaskBranch({ title: "Fix login", prompt: "p" });
    expect(branch).toBe("maverick/login-page");
  });

  it("falls back to the title slug in the scheme when AI is disabled", async () => {
    useSettingsStore.setState({
      values: { "general.aiBranchNames": false, "general.namingScheme": "feature/{feature-name}" },
    });
    const branch = await resolveTaskBranch({ title: "Fix Login Bug", prompt: "p" });
    expect(branch).toBe("feature/fix-login-bug");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("falls back to the scheme when the AI call fails", async () => {
    useSettingsStore.setState({ values: { "general.namingScheme": "maverick/{feature-name}" } });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("down"));
    const branch = await resolveTaskBranch({ title: "Fix Login", prompt: "p", instructions: "feature/x" });
    expect(branch).toBe("maverick/fix-login");
  });
});
