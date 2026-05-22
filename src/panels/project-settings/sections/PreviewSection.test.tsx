import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import PreviewSection from "./PreviewSection";

const BASE = {
  name: "demo",
  rootPath: "/p",
  workspaces: { branchFrom: "origin/main", filesToCopy: [] },
  remote: "origin",
  previewUrl: "http://localhost:${WORKSPACE_PORT}",
  scripts: { setup: "", run: "", archive: "" },
  preferences: {},
};

beforeEach(() => {
  vi.mocked(invoke).mockRejectedValue(new Error("noop"));
  useProjectSettingsStore.setState({ data: BASE, projectId: "p1", status: "loaded", dirty: {}, lastError: null });
});

describe("PreviewSection", () => {
  it("renders previewUrl with env-var helper", () => {
    renderWithProviders(<PreviewSection />);
    expect(screen.getByDisplayValue("http://localhost:${WORKSPACE_PORT}")).toBeInTheDocument();
    expect(screen.getByText(/WORKSPACE_NAME/)).toBeInTheDocument();
  });

  it("patches on edit + blur", async () => {
    renderWithProviders(<PreviewSection />);
    const input = screen.getByDisplayValue("http://localhost:${WORKSPACE_PORT}");
    await userEvent.clear(input);
    await userEvent.type(input, "http://localhost:5173");
    await userEvent.tab();
    expect(useProjectSettingsStore.getState().dirty.previewUrl).toBe("http://localhost:5173");
  });
});
