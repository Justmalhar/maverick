import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import IdentitySection from "./IdentitySection";

const STUB = {
  name: "demo",
  rootPath: "/p/demo",
  workspaces: { branchFrom: "origin/main", filesToCopy: [] },
  remote: "origin",
  previewUrl: "",
  scripts: { setup: "", run: "", archive: "" },
  preferences: {},
};

beforeEach(() => {
  vi.mocked(invoke).mockRejectedValue(new Error("noop"));
  useProjectSettingsStore.setState({
    data: STUB,
    projectId: "p1",
    status: "loaded",
    dirty: {},
    lastError: null,
  });
});

describe("IdentitySection", () => {
  it("renders name and root path", () => {
    renderWithProviders(<IdentitySection />);
    expect(screen.getByDisplayValue("demo")).toBeInTheDocument();
    expect(screen.getByText("/p/demo")).toBeInTheDocument();
  });

  it("blur on name triggers patch", async () => {
    renderWithProviders(<IdentitySection />);
    const input = screen.getByDisplayValue("demo");
    await userEvent.clear(input);
    await userEvent.type(input, "alpha");
    await userEvent.tab();
    expect(useProjectSettingsStore.getState().dirty.name).toBe("alpha");
  });
});
