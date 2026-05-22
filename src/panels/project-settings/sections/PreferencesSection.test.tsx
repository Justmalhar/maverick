import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import PreferencesSection from "./PreferencesSection";

const BASE = {
  name: "demo",
  rootPath: "/p",
  workspaces: { branchFrom: "origin/main", filesToCopy: [] },
  remote: "origin",
  previewUrl: "",
  scripts: { setup: "", run: "", archive: "" },
  preferences: {},
};

beforeEach(() => {
  vi.mocked(invoke).mockRejectedValue(new Error("noop"));
  useProjectSettingsStore.setState({ data: BASE, projectId: "p1", status: "loaded", dirty: {}, lastError: null });
});

describe("PreferencesSection", () => {
  it("renders 6 textareas", () => {
    renderWithProviders(<PreferencesSection />);
    ["Review", "Create PR", "Fix errors", "Resolve conflicts", "Branch rename", "General"].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it("blur on Review patches preferences.review", async () => {
    renderWithProviders(<PreferencesSection />);
    const ta = screen.getByTestId("preferences-review");
    await userEvent.type(ta, "be terse");
    await userEvent.tab();
    expect(useProjectSettingsStore.getState().dirty.preferences?.review).toBe("be terse");
  });
});
