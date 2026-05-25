import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { EmptyEditor } from "./EmptyEditor";
import { useWorkbench } from "@/state/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@/lib/dialog", () => ({ pickProjectFolder: vi.fn() }));

import { pickProjectFolder } from "@/lib/dialog";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(pickProjectFolder).mockReset();
  vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
  useWorkbench.setState({
    ...initial, commandPaletteOpen: false, presetLauncherOpen: false,
    layout: { ...initial.layout, activityView: "git" },
  });
});

describe("EmptyEditor", () => {
  it("renders welcome, three CTAs and kbd hints", () => {
    renderWithProviders(<EmptyEditor />);
    expect(screen.getByTestId("empty-editor")).toBeInTheDocument();
    expect(screen.getByText("Maverick")).toBeInTheDocument();
  });

  it("clicking Add project sets the projects view", async () => {
    renderWithProviders(<EmptyEditor />);
    await userEvent.click(screen.getByTestId("empty-add-project"));
    expect(useWorkbench.getState().layout.activityView).toBe("projects");
  });

  it("adds project when pickProjectFolder returns a path", async () => {
    vi.mocked(pickProjectFolder).mockResolvedValueOnce("/my/new/project");
    vi.mocked(invoke).mockResolvedValue({ id: "p-new", name: "project", path: "/my/new/project" } as never);
    renderWithProviders(<EmptyEditor />);
    await userEvent.click(screen.getByTestId("empty-add-project"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("project_add", { path: "/my/new/project" })
    );
  });

  it("logs error when addProjectFromPath fails", async () => {
    vi.mocked(pickProjectFolder).mockResolvedValueOnce("/bad/path");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("permission denied"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(<EmptyEditor />);
    await userEvent.click(screen.getByTestId("empty-add-project"));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith("addProject failed", expect.any(Error)));
    errorSpy.mockRestore();
  });

  it("clicking Open preset opens the preset launcher", async () => {
    renderWithProviders(<EmptyEditor />);
    await userEvent.click(screen.getByTestId("empty-presets"));
    expect(useWorkbench.getState().presetLauncherOpen).toBe(true);
  });

  it("clicking Commands opens the command palette", async () => {
    renderWithProviders(<EmptyEditor />);
    await userEvent.click(screen.getByTestId("empty-commands"));
    expect(useWorkbench.getState().commandPaletteOpen).toBe(true);
  });
});
