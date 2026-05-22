import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { Panel } from "./Panel";

const BASE_SETTINGS = (overrides: object = {}) => ({
  name: "demo", rootPath: "/p",
  workspaces: { branchFrom: "origin/main", filesToCopy: [] },
  remote: "origin", previewUrl: "",
  scripts: { setup: "", run: "", archive: "" },
  preferences: {},
  ...overrides,
});

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({
    projects: [{ id: "p1", name: "demo", path: "/p", createdAt: 0 }],
    workspaces: [{ id: "w1", projectId: "p1", branch: "main", agentBackend: "claude", worktreePath: "/p/w", status: "active", sessionId: "s1" }],
    activeWorkspaceId: "w1",
    projectSettings: { open: false, projectId: null },
  } as never);
  useProjectSettingsStore.setState({ data: BASE_SETTINGS(), projectId: "p1", status: "loaded", dirty: {}, lastError: null });
});

describe("Panel", () => {
  it("shows Add setup script CTA when scripts.setup is empty", () => {
    renderWithProviders(<Panel />);
    expect(screen.getByRole("button", { name: /Add setup script/i })).toBeInTheDocument();
  });

  it("CTA opens ProjectSettings to scripts/setup", async () => {
    renderWithProviders(<Panel />);
    await userEvent.click(screen.getByRole("button", { name: /Add setup script/i }));
    const ps = useWorkbench.getState().projectSettings;
    expect(ps.open).toBe(true);
    expect(ps.projectId).toBe("p1");
    expect(ps.initialSection).toBe("scripts");
    expect(ps.focusField).toBe("setup");
  });

  it("configured setup → Run setup button visible", () => {
    useProjectSettingsStore.setState({ data: BASE_SETTINGS({ scripts: { setup: "bun install", run: "", archive: "" } }), projectId: "p1", status: "loaded", dirty: {}, lastError: null });
    renderWithProviders(<Panel />);
    expect(screen.getByRole("button", { name: /Run setup/i })).toBeInTheDocument();
  });

  it("Run tab CTA opens ProjectSettings to scripts/run", async () => {
    renderWithProviders(<Panel />);
    await userEvent.click(screen.getByTestId("panel-tab-run"));
    await userEvent.click(screen.getByRole("button", { name: /Add run script/i }));
    const ps = useWorkbench.getState().projectSettings;
    expect(ps.initialSection).toBe("scripts");
    expect(ps.focusField).toBe("run");
  });
});
