import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
import { PanelTabs } from "./PanelTabs";
import { useWorkbench } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, layout: { ...initial.layout, panelVisible: true } });
});

describe("PanelTabs", () => {
  it("invokes onChange when a tab is clicked", async () => {
    const onChange = vi.fn();
    renderWithProviders(<PanelTabs value="setup" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("panel-tab-run"));
    expect(onChange).toHaveBeenCalledWith("run");
  });

  it("renders the Terminal tab and invokes onChange when clicked", async () => {
    const onChange = vi.fn();
    renderWithProviders(<PanelTabs value="setup" onChange={onChange} />);
    expect(screen.getByTestId("panel-tab-terminal")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("panel-tab-terminal"));
    expect(onChange).toHaveBeenCalledWith("terminal");
  });

  it("collapse button toggles panel in store", async () => {
    renderWithProviders(<PanelTabs value="setup" onChange={() => {}} />);
    await userEvent.click(screen.getByTestId("panel-collapse"));
    expect(useWorkbench.getState().layout.panelVisible).toBe(false);
  });

  it("shows Open preview button when previewUrl is set", () => {
    useWorkbench.setState({
      activeWorkspaceId: "w1",
      workspaces: [{ id: "w1", projectId: "p1", branch: "main", agentBackend: "claude", worktreePath: "/p/w", status: "active", sessionId: "s1" }],
    } as never);
    useProjectSettingsStore.setState({
      data: { name: "demo", rootPath: "/p", workspaces: { branchFrom: "origin/main", filesToCopy: [] }, remote: "origin", previewUrl: "http://localhost:${WORKSPACE_PORT}", scripts: { setup: "", run: "", archive: "" }, preferences: {} },
      projectId: "p1", status: "loaded", dirty: {}, lastError: null,
    });
    renderWithProviders(<PanelTabs value="setup" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Open preview/i })).toBeInTheDocument();
  });

  it("clicking Open preview button triggers dynamic shell import without crashing", async () => {
    useWorkbench.setState({
      activeWorkspaceId: "w1",
      workspaces: [{ id: "w1", projectId: "p1", branch: "main", agentBackend: "claude", worktreePath: "/p/w", status: "active", sessionId: "s1" }],
    } as never);
    useProjectSettingsStore.setState({
      data: { name: "demo", rootPath: "/p", workspaces: { branchFrom: "origin/main", filesToCopy: [] }, remote: "origin", previewUrl: "http://localhost:3000", scripts: { setup: "", run: "", archive: "" }, preferences: {} },
      projectId: "p1", status: "loaded", dirty: {}, lastError: null,
    });
    renderWithProviders(<PanelTabs value="setup" onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Open preview/i }));
    // Dynamic import fires but shell.open is mocked — no crash is the criterion
  });
});
