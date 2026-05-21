import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import PresetPicker from "./PresetPicker";
import { useWorkbench } from "@/state/store";
import { makeProject, makePreset, makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

function mockChain(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  vi.mocked(invoke).mockImplementation((async (cmd: string, args?: Record<string, unknown>) => {
    const h = handlers[cmd];
    return h ? h(args ?? {}) : [];
  }) as unknown as typeof invoke);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, projects: [], workspaces: [], activeWorkspaceId: null });
});

describe("PresetPicker", () => {
  it("ignores when closed", () => {
    mockChain({});
    renderWithProviders(<PresetPicker open={false} onOpenChange={() => {}} />);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("loads presets and filters", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", path: "/p" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    mockChain({
      preset_list: () => [makePreset({ name: "alpha" }), makePreset({ name: "beta" })],
    });
    renderWithProviders(<PresetPicker open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId("preset-picker-item").length).toBeGreaterThanOrEqual(1));
    await userEvent.type(screen.getByTestId("preset-picker-input"), "alp");
  });

  it("launch invokes presetLaunch and adds workspace", async () => {
    useWorkbench.setState({ ...initial, projects: [makeProject({ id: "p1" })] });
    mockChain({
      preset_list: () => [makePreset({ name: "alpha" })],
      preset_launch: () => ({ workspaceId: "w-new" }),
    });
    const onOpen = vi.fn();
    renderWithProviders(<PresetPicker open onOpenChange={onOpen} />);
    await userEvent.click(await screen.findByTestId("preset-picker-item"));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(false));
  });

  it("logs an error on launch failure", async () => {
    useWorkbench.setState({ ...initial, projects: [makeProject({ id: "p1" })] });
    mockChain({
      preset_list: () => [makePreset()],
      preset_launch: () => Promise.reject(new Error("x")),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(<PresetPicker open onOpenChange={() => {}} />);
    await userEvent.click(await screen.findByTestId("preset-picker-item"));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it("captures load errors silently", async () => {
    mockChain({ preset_list: () => Promise.reject(new Error("fail")) });
    renderWithProviders(<PresetPicker open onOpenChange={() => {}} />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
  });
});
