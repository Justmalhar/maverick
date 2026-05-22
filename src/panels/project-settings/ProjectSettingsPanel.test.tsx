import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import ProjectSettingsPanel from "./ProjectSettingsPanel";

const STUB = {
  name: "demo",
  rootPath: "/p",
  workspaces: { branchFrom: "origin/main", filesToCopy: [] },
  remote: "origin",
  previewUrl: "",
  scripts: { setup: "", run: "", archive: "" },
  preferences: {},
};

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(STUB as never);
  useProjectSettingsStore.setState({
    projectId: null,
    status: "idle",
    data: null,
    dirty: {},
    lastError: null,
  });
  useWorkbench.setState({
    projects: [{ id: "p1", name: "demo", path: "/p", createdAt: 0 }],
  } as never);
});

describe("ProjectSettingsPanel", () => {
  it("loads project settings on open and displays project name in title", async () => {
    renderWithProviders(
      <ProjectSettingsPanel
        open
        projectId="p1"
        onOpenChange={() => {}}
        initialSection="scripts"
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/Project Settings · demo/)).toBeInTheDocument(),
    );
  });

  it("switches sections via nav", async () => {
    renderWithProviders(
      <ProjectSettingsPanel
        open
        projectId="p1"
        onOpenChange={() => {}}
        initialSection="identity"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("project-identity")).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByTestId("project-nav-scripts"));
    expect(screen.getByTestId("project-scripts")).toBeInTheDocument();
  });
});
