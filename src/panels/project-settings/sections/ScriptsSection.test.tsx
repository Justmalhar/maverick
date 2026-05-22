import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import ScriptsSection from "./ScriptsSection";

const BASE = {
  name: "demo",
  rootPath: "/p",
  workspaces: { branchFrom: "origin/main", filesToCopy: [] },
  remote: "origin",
  previewUrl: "",
  scripts: { setup: "bun install", run: "", archive: "" },
  preferences: {},
};

beforeEach(() => {
  vi.mocked(invoke).mockRejectedValue(new Error("noop"));
  useProjectSettingsStore.setState({ data: BASE, projectId: "p1", status: "loaded", dirty: {}, lastError: null });
});

describe("ScriptsSection", () => {
  it("renders three textareas", () => {
    renderWithProviders(<ScriptsSection />);
    expect(screen.getByDisplayValue("bun install")).toBeInTheDocument();
    expect(screen.getByLabelText(/Run script/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Archive script/i)).toBeInTheDocument();
  });

  it("blur on Run patches and flushes", async () => {
    renderWithProviders(<ScriptsSection />);
    const ta = screen.getByLabelText(/Run script/i);
    await userEvent.type(ta, "bun run dev");
    await userEvent.tab();
    expect(useProjectSettingsStore.getState().dirty.scripts?.run).toBe("bun run dev");
  });
});
