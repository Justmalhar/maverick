import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { useWorkbench } from "@/state/store";
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
  useWorkbench.setState({ workspaces: [] });
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

  it("renders nothing when settings data is absent", () => {
    useProjectSettingsStore.setState({
      data: null,
      projectId: "p1",
      status: "idle",
      dirty: {},
      lastError: null,
    });
    const { container } = renderWithProviders(<IdentitySection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not call removeProject when projectId is null", async () => {
    useProjectSettingsStore.setState({
      data: STUB,
      projectId: null,
      status: "loaded",
      dirty: {},
      lastError: null,
    });
    renderWithProviders(<IdentitySection />);
    await userEvent.click(screen.getByRole("button", { name: /remove project/i }));
    await userEvent.click(screen.getByTestId("confirm-remove-project"));
    expect(removeProject).not.toHaveBeenCalled();
  });

  it("surfaces an error notification when removeProject rejects with an Error", async () => {
    removeProject.mockRejectedValueOnce(new Error("boom"));
    vi.mocked(invoke).mockResolvedValueOnce({ ok: true }); // allow notify_send to resolve
    renderWithProviders(<IdentitySection />);
    await userEvent.click(screen.getByRole("button", { name: /remove project/i }));
    await userEvent.click(screen.getByTestId("confirm-remove-project"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "notify_send",
        expect.objectContaining({ type: "error" }),
      );
    });
  });

  it("surfaces an error notification when removeProject rejects with a non-Error value", async () => {
    removeProject.mockRejectedValueOnce("plain string error");
    vi.mocked(invoke).mockResolvedValueOnce({ ok: true }); // allow notify_send to resolve
    renderWithProviders(<IdentitySection />);
    await userEvent.click(screen.getByRole("button", { name: /remove project/i }));
    await userEvent.click(screen.getByTestId("confirm-remove-project"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "notify_send",
        expect.objectContaining({ type: "error" }),
      );
    });
  });

  it("uses the singular noun when the project has exactly one workspace", async () => {
    useWorkbench.setState({
      workspaces: [
        {
          id: "w1",
          projectId: "p1",
          branch: "callsign/x",
          agentBackend: "claude",
          worktreePath: "/p/demo/.maverick/w1",
          status: "idle",
          sessionId: "s1",
        },
      ],
    });
    renderWithProviders(<IdentitySection />);
    await userEvent.click(screen.getByRole("button", { name: /remove project/i }));
    expect(screen.getByText(/its 1 workspace /)).toBeInTheDocument();
  });
});
