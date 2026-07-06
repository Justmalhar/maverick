import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import AutopilotPanel from "./AutopilotPanel";
import { useWorkbench } from "@/state/store";
import { makeProject, makeBackend } from "@/test/fixtures";
import type { Autopilot } from "@/lib/ipc";

const initial = useWorkbench.getState();

function makeAutopilot(overrides: Partial<Autopilot> = {}): Autopilot {
  return {
    id: "a1", projectId: "p1", name: "nightly", backend: "claude", branch: "",
    prompt: "clean up", intervalMinutes: 60, enabled: true, lastRunAt: null,
    lastStatus: "never", createdAt: 1700000000,
    ...overrides,
  };
}

function mockInvoke(overrides: Record<string, (args?: unknown) => unknown> = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (overrides[cmd]) return overrides[cmd](args) as never;
    if (cmd === "autopilot_list") return [] as never;
    return undefined as never;
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({
    ...initial,
    projects: [makeProject({ id: "p1", name: "Alpha" })],
    backends: [makeBackend({ id: "claude", name: "Claude" })],
  });
});

describe("AutopilotPanel", () => {
  it("shows the empty state when no autopilots exist", async () => {
    mockInvoke();
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByTestId("autopilot-empty")).toBeInTheDocument());
  });

  it("renders autopilot cards", async () => {
    mockInvoke({ autopilot_list: () => [makeAutopilot()] });
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByTestId("autopilot-card-a1")).toBeInTheDocument());
    expect(screen.getByText(/every 60m/)).toBeInTheDocument();
  });

  it("captures list errors", async () => {
    mockInvoke({ autopilot_list: () => { throw new Error("boom"); } });
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });

  it("creates a new autopilot via the dialog", async () => {
    const calls: unknown[] = [];
    mockInvoke({
      autopilot_upsert: (args) => { calls.push(args); return makeAutopilot(); },
    });
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByTestId("autopilot-empty")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("autopilot-new"));
    await userEvent.type(await screen.findByTestId("autopilot-name"), "New one");
    await userEvent.click(screen.getByTestId("autopilot-submit"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ autopilot: expect.objectContaining({ projectId: "p1", name: "New one" }) });
  });

  it("disables New autopilot when there are no projects", async () => {
    useWorkbench.setState({ ...initial, projects: [], backends: [] });
    mockInvoke();
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByTestId("autopilot-empty")).toBeInTheDocument());
    expect(screen.getByTestId("autopilot-new")).toBeDisabled();
  });

  it("edits an existing autopilot", async () => {
    const calls: unknown[] = [];
    mockInvoke({
      autopilot_list: () => [makeAutopilot()],
      autopilot_upsert: (args) => { calls.push(args); return makeAutopilot({ name: "renamed" }); },
    });
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByTestId("autopilot-card-a1")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("autopilot-edit-a1"));
    const nameInput = await screen.findByTestId("autopilot-name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "renamed");
    await userEvent.click(screen.getByTestId("autopilot-submit"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ autopilot: expect.objectContaining({ id: "a1", name: "renamed" }) });
  });

  it("toggles enabled state", async () => {
    const calls: unknown[] = [];
    mockInvoke({
      autopilot_list: () => [makeAutopilot({ enabled: true })],
      autopilot_upsert: (args) => { calls.push(args); return makeAutopilot({ enabled: false }); },
    });
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByTestId("autopilot-toggle-a1")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("autopilot-toggle-a1"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ autopilot: expect.objectContaining({ enabled: false }) });
  });

  it("runs an autopilot now", async () => {
    const calls: unknown[] = [];
    mockInvoke({
      autopilot_list: () => [makeAutopilot()],
      autopilot_run_now: (args) => { calls.push(args); return { ok: true }; },
    });
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByTestId("autopilot-run-a1")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("autopilot-run-a1"));
    await waitFor(() => expect(calls).toEqual([{ id: "a1" }]));
  });

  it("surfaces a run-now failure", async () => {
    mockInvoke({
      autopilot_list: () => [makeAutopilot()],
      autopilot_run_now: () => ({ ok: false, error: "disabled" }),
    });
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByTestId("autopilot-run-a1")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("autopilot-run-a1"));
    await waitFor(() => expect(screen.getByText("disabled")).toBeInTheDocument());
  });

  it("reveals webhook info", async () => {
    mockInvoke({
      autopilot_webhook_info: () => ({ url: "http://127.0.0.1:1234/autopilot-trigger", token: "tok123" }),
    });
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByTestId("autopilot-empty")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("autopilot-webhook-info"));
    await waitFor(() => expect(screen.getByTestId("autopilot-webhook-details")).toBeInTheDocument());
    expect(screen.getByText("http://127.0.0.1:1234/autopilot-trigger")).toBeInTheDocument();
  });

  it("surfaces a webhook info error", async () => {
    mockInvoke({
      autopilot_webhook_info: () => { throw new Error("no server"); },
    });
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByTestId("autopilot-empty")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("autopilot-webhook-info"));
    await waitFor(() => expect(screen.getByText(/no server/)).toBeInTheDocument());
  });

  it("refresh button reloads the list", async () => {
    mockInvoke();
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByTestId("autopilot-empty")).toBeInTheDocument());
    const before = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "autopilot_list").length;
    await userEvent.click(screen.getByTestId("autopilot-refresh"));
    await waitFor(() => {
      const after = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "autopilot_list").length;
      expect(after).toBeGreaterThan(before);
    });
  });

  it("deletes an autopilot from the dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const calls: unknown[] = [];
    mockInvoke({
      autopilot_list: () => [makeAutopilot()],
      autopilot_delete: (args) => { calls.push(args); return { ok: true }; },
    });
    renderWithProviders(<AutopilotPanel />);
    await waitFor(() => expect(screen.getByTestId("autopilot-card-a1")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("autopilot-edit-a1"));
    await userEvent.click(await screen.findByTestId("autopilot-delete"));
    await waitFor(() => expect(calls).toEqual([{ id: "a1" }]));
    confirmSpy.mockRestore();
  });
});
