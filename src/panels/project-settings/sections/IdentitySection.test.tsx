import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import IdentitySection from "./IdentitySection";

const removeProject = vi.fn();
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ removeProject }),
}));

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
  removeProject.mockReset();
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

  it("confirm dialog removes the project", async () => {
    renderWithProviders(<IdentitySection />);
    await userEvent.click(screen.getByRole("button", { name: /remove project/i }));
    // Dialog confirm button (distinct from the trigger).
    await userEvent.click(screen.getByTestId("confirm-remove-project"));
    expect(removeProject).toHaveBeenCalledWith("p1");
  });

  it("cancel does not remove the project", async () => {
    renderWithProviders(<IdentitySection />);
    await userEvent.click(screen.getByRole("button", { name: /remove project/i }));
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(removeProject).not.toHaveBeenCalled();
  });
});
