import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { Panel } from "./Panel";
import { useScriptRunner } from "@/hooks/useScriptRunner";

vi.mock("@/hooks/useScriptRunner");

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
  vi.mocked(useScriptRunner).mockReturnValue({
    state: "idle", exitCode: null, startedAt: null, output: "",
    start: vi.fn(), stop: vi.fn(),
  });
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

  it("configured setup → Run setup button visible when idle", () => {
    useProjectSettingsStore.setState({ data: BASE_SETTINGS({ scripts: { setup: "bun install", run: "", archive: "" } }), projectId: "p1", status: "loaded", dirty: {}, lastError: null });
    renderWithProviders(<Panel />);
    expect(screen.getByRole("button", { name: /Run setup/i })).toBeInTheDocument();
  });

  it("Stop button visible when runner is running", () => {
    vi.mocked(useScriptRunner).mockReturnValue({
      state: "running", exitCode: null, startedAt: Date.now(), output: "running...",
      start: vi.fn(), stop: vi.fn(),
    });
    useProjectSettingsStore.setState({ data: BASE_SETTINGS({ scripts: { setup: "bun install", run: "", archive: "" } }), projectId: "p1", status: "loaded", dirty: {}, lastError: null });
    renderWithProviders(<Panel />);
    expect(screen.getByRole("button", { name: /Stop/i })).toBeInTheDocument();
  });

  it("shows exit error banner when runner exited with non-zero code", async () => {
    const mockStart = vi.fn();
    vi.mocked(useScriptRunner).mockReturnValue({
      state: "exited", exitCode: 1, startedAt: Date.now(), output: "error output",
      start: mockStart, stop: vi.fn(),
    });
    useProjectSettingsStore.setState({ data: BASE_SETTINGS({ scripts: { setup: "bun install", run: "", archive: "" } }), projectId: "p1", status: "loaded", dirty: {}, lastError: null });
    renderWithProviders(<Panel />);
    const banner = await waitFor(() => screen.getByText(/Exited 1/i));
    expect(banner).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Retry/i }));
    expect(mockStart).toHaveBeenCalled();
  });

  it("Run tab CTA opens ProjectSettings to scripts/run", async () => {
    renderWithProviders(<Panel />);
    await userEvent.click(screen.getByTestId("panel-tab-run"));
    await userEvent.click(screen.getByRole("button", { name: /Add run script/i }));
    const ps = useWorkbench.getState().projectSettings;
    expect(ps.initialSection).toBe("scripts");
    expect(ps.focusField).toBe("run");
  });

  it("Run button click starts the runner", async () => {
    const mockStart = vi.fn();
    vi.mocked(useScriptRunner).mockReturnValue({
      state: "idle", exitCode: null, startedAt: null, output: "",
      start: mockStart, stop: vi.fn(),
    });
    useProjectSettingsStore.setState({ data: BASE_SETTINGS({ scripts: { setup: "bun install", run: "", archive: "" } }), projectId: "p1", status: "loaded", dirty: {}, lastError: null });
    renderWithProviders(<Panel />);
    await userEvent.click(screen.getByRole("button", { name: /Run setup/i }));
    expect(mockStart).toHaveBeenCalled();
  });

  it("Stop button click stops the runner", async () => {
    const mockStop = vi.fn();
    vi.mocked(useScriptRunner).mockReturnValue({
      state: "running", exitCode: null, startedAt: Date.now(), output: "running...",
      start: vi.fn(), stop: mockStop,
    });
    useProjectSettingsStore.setState({ data: BASE_SETTINGS({ scripts: { setup: "bun install", run: "", archive: "" } }), projectId: "p1", status: "loaded", dirty: {}, lastError: null });
    renderWithProviders(<Panel />);
    await userEvent.click(screen.getByRole("button", { name: /Stop/i }));
    expect(mockStop).toHaveBeenCalled();
  });

  it("shows empty state CTA when no active workspace", () => {
    useWorkbench.setState({ ...useWorkbench.getState(), activeWorkspaceId: null });
    renderWithProviders(<Panel />);
    expect(screen.getByRole("button", { name: /Open Project Settings/i })).toBeInTheDocument();
  });

  it("no-workspace CTA button is clickable (no-op)", async () => {
    useWorkbench.setState({ ...useWorkbench.getState(), activeWorkspaceId: null });
    renderWithProviders(<Panel />);
    await userEvent.click(screen.getByRole("button", { name: /Open Project Settings/i }));
  });

  it("maverick:panel:tab event switches to the run tab", async () => {
    renderWithProviders(<Panel />);
    fireEvent(window, new CustomEvent("maverick:panel:tab", { detail: "run" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Add run script/i })).toBeInTheDocument()
    );
  });

  it("maverick:panel:tab event ignores unknown tab values", () => {
    renderWithProviders(<Panel />);
    fireEvent(window, new CustomEvent("maverick:panel:tab", { detail: "unknown" }));
    expect(screen.getByTestId("panel-tab-setup")).toBeInTheDocument();
  });

  it("auto-runs a pending setup once when settings for the project are loaded", async () => {
    const mockStart = vi.fn();
    vi.mocked(useScriptRunner).mockReturnValue({
      state: "idle", exitCode: null, startedAt: null, output: "",
      start: mockStart, stop: vi.fn(),
    });
    useProjectSettingsStore.setState({ data: BASE_SETTINGS({ scripts: { setup: "bun install", run: "", archive: "" } }), projectId: "p1", status: "loaded", dirty: {}, lastError: null });
    useWorkbench.setState({ pendingSetupIds: ["w1"] } as never);
    renderWithProviders(<Panel />);
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    expect(useWorkbench.getState().pendingSetupIds).toEqual([]);
  });

  it("does NOT auto-run setup while the loaded settings belong to another project", () => {
    const mockStart = vi.fn();
    vi.mocked(useScriptRunner).mockReturnValue({
      state: "idle", exitCode: null, startedAt: null, output: "",
      start: mockStart, stop: vi.fn(),
    });
    // Stale settings: store still holds project p2's data.
    useProjectSettingsStore.setState({ data: BASE_SETTINGS({ scripts: { setup: "rm -rf other", run: "", archive: "" } }), projectId: "p2", status: "loaded", dirty: {}, lastError: null });
    useWorkbench.setState({ pendingSetupIds: ["w1"] } as never);
    renderWithProviders(<Panel />);
    expect(mockStart).not.toHaveBeenCalled();
    expect(useWorkbench.getState().pendingSetupIds).toEqual(["w1"]);
  });

  it("clears a pending setup without starting when the project has no setup script", async () => {
    const mockStart = vi.fn();
    vi.mocked(useScriptRunner).mockReturnValue({
      state: "idle", exitCode: null, startedAt: null, output: "",
      start: mockStart, stop: vi.fn(),
    });
    useProjectSettingsStore.setState({ data: BASE_SETTINGS(), projectId: "p1", status: "loaded", dirty: {}, lastError: null });
    useWorkbench.setState({ pendingSetupIds: ["w1"] } as never);
    renderWithProviders(<Panel />);
    await waitFor(() => expect(useWorkbench.getState().pendingSetupIds).toEqual([]));
    expect(mockStart).not.toHaveBeenCalled();
  });
});
