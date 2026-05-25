import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
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

  it("renders null when data is null", () => {
    useProjectSettingsStore.setState({ projectId: "p1", status: "loaded", dirty: {}, lastError: null, data: null });
    const { container } = renderWithProviders(<WorkspacesSection />);
    expect(container.firstChild).toBeNull();
  });

  it("blur on branchFrom input triggers flush", async () => {
    renderWithProviders(<WorkspacesSection />);
    const input = screen.getByDisplayValue("origin/main");
    await userEvent.click(input);
    await userEvent.tab();
  });

  it("onChange on branchFrom patches the branch name", async () => {
    renderWithProviders(<WorkspacesSection />);
    const input = screen.getByDisplayValue("origin/main");
    fireEvent.change(input, { target: { value: "main" } });
    expect(useProjectSettingsStore.getState().dirty.workspaces?.branchFrom).toBe("main");
  });

  it("onChange on remote patches the remote", async () => {
    renderWithProviders(<WorkspacesSection />);
    const input = screen.getByDisplayValue("origin");
    fireEvent.change(input, { target: { value: "upstream" } });
    expect(useProjectSettingsStore.getState().dirty.remote).toBe("upstream");
  });

  it("remove file button removes the file from the list", async () => {
    renderWithProviders(<WorkspacesSection />);
    await userEvent.click(screen.getByLabelText("Remove .env"));
    expect(useProjectSettingsStore.getState().dirty.workspaces?.filesToCopy).toEqual([]);
  });

  it("addFile with whitespace-only input is a no-op", async () => {
    renderWithProviders(<WorkspacesSection />);
    const input = screen.getByPlaceholderText(".env.local");
    await userEvent.type(input, "   {Enter}");
    expect(useProjectSettingsStore.getState().dirty.workspaces?.filesToCopy).toBeUndefined();
  });
});
