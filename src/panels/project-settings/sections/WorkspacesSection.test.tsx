import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import WorkspacesSection from "./WorkspacesSection";

beforeEach(() => {
  vi.mocked(invoke).mockRejectedValue(new Error("noop"));
  useProjectSettingsStore.setState({
    projectId: "p1",
    status: "loaded",
    dirty: {},
    lastError: null,
    data: {
      name: "demo",
      rootPath: "/p/demo",
      workspaces: { branchFrom: "origin/main", filesToCopy: [".env"] },
      remote: "origin",
      previewUrl: "",
      scripts: { setup: "", run: "", archive: "" },
      preferences: {},
    },
  });
});

describe("WorkspacesSection", () => {
  it("renders branchFrom, remote, filesToCopy", () => {
    renderWithProviders(<WorkspacesSection />);
    expect(screen.getByDisplayValue("origin/main")).toBeInTheDocument();
    expect(screen.getByDisplayValue("origin")).toBeInTheDocument();
    expect(screen.getByText(".env")).toBeInTheDocument();
  });

  it("add file-to-copy patches array", async () => {
    renderWithProviders(<WorkspacesSection />);
    const input = screen.getByPlaceholderText(".env.local");
    await userEvent.type(input, ".npmrc{Enter}");
    expect(useProjectSettingsStore.getState().dirty.workspaces?.filesToCopy).toEqual([".env", ".npmrc"]);
  });
});
