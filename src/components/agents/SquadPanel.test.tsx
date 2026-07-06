import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import SquadPanel from "./SquadPanel";
import { sendAgentPrompt } from "@/lib/ai-actions";
import { useWorkbench } from "@/state/store";
import { makeProject, makeWorkspace } from "@/test/fixtures";
import type { Squad } from "@/lib/ipc";

vi.mock("@/lib/ai-actions", () => ({
  sendAgentPrompt: vi.fn(),
}));

const initial = useWorkbench.getState();

function makeSquad(overrides: Partial<Squad> = {}): Squad {
  return {
    id: "s1", projectId: "p1", name: "auth-refactor",
    leaderWorkspaceId: "ws-1", memberWorkspaceIds: ["ws-1", "ws-2"], createdAt: 1700000000,
    ...overrides,
  };
}

function mockInvoke(overrides: Record<string, (args?: unknown) => unknown> = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (overrides[cmd]) return overrides[cmd](args) as never;
    if (cmd === "squad_list") return [] as never;
    return undefined as never;
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(sendAgentPrompt).mockReset();
  useWorkbench.setState({
    ...initial,
    projects: [makeProject({ id: "p1", name: "Alpha" })],
    workspaces: [
      makeWorkspace({ id: "ws-1", title: "backend", projectId: "p1" }),
      makeWorkspace({ id: "ws-2", title: "frontend", projectId: "p1" }),
    ],
  });
});

describe("SquadPanel", () => {
  it("shows the empty state when no squads exist", async () => {
    mockInvoke();
    renderWithProviders(<SquadPanel />);
    await waitFor(() => expect(screen.getByTestId("squad-empty")).toBeInTheDocument());
  });

  it("renders squad cards with leader and member counts", async () => {
    mockInvoke({ squad_list: () => [makeSquad()] });
    renderWithProviders(<SquadPanel />);
    await waitFor(() => expect(screen.getByTestId("squad-card-s1")).toBeInTheDocument());
    expect(screen.getByText(/backend/)).toBeInTheDocument();
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
  });

  it("captures list errors", async () => {
    mockInvoke({ squad_list: () => { throw new Error("boom"); } });
    renderWithProviders(<SquadPanel />);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });

  it("creates a new squad via the dialog", async () => {
    const calls: unknown[] = [];
    mockInvoke({ squad_upsert: (args) => { calls.push(args); return makeSquad(); } });
    renderWithProviders(<SquadPanel />);
    await waitFor(() => expect(screen.getByTestId("squad-empty")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("squad-new"));
    await userEvent.type(await screen.findByTestId("squad-name"), "New squad");
    await userEvent.click(screen.getByTestId("squad-submit"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ squad: expect.objectContaining({ projectId: "p1", name: "New squad" }) });
  });

  it("disables New squad when there are no projects", async () => {
    useWorkbench.setState({ ...initial, projects: [], workspaces: [] });
    mockInvoke();
    renderWithProviders(<SquadPanel />);
    await waitFor(() => expect(screen.getByTestId("squad-empty")).toBeInTheDocument());
    expect(screen.getByTestId("squad-new")).toBeDisabled();
  });

  it("edits an existing squad", async () => {
    const calls: unknown[] = [];
    mockInvoke({
      squad_list: () => [makeSquad()],
      squad_upsert: (args) => { calls.push(args); return makeSquad({ name: "renamed" }); },
    });
    renderWithProviders(<SquadPanel />);
    await waitFor(() => expect(screen.getByTestId("squad-card-s1")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("squad-edit-s1"));
    const nameInput = await screen.findByTestId("squad-name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "renamed");
    await userEvent.click(screen.getByTestId("squad-submit"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ squad: expect.objectContaining({ id: "s1", name: "renamed" }) });
  });

  it("opens the broadcast dialog and sends to members", async () => {
    vi.mocked(sendAgentPrompt).mockResolvedValue({ ran: true });
    mockInvoke({ squad_list: () => [makeSquad()] });
    renderWithProviders(<SquadPanel />);
    await waitFor(() => expect(screen.getByTestId("squad-broadcast-s1")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("squad-broadcast-s1"));
    await userEvent.type(await screen.findByTestId("squad-broadcast-prompt"), "go");
    await userEvent.click(screen.getByTestId("squad-broadcast-send"));
    await waitFor(() => expect(sendAgentPrompt).toHaveBeenCalledTimes(2));
  });

  it("disables broadcast for a squad with no members", async () => {
    mockInvoke({ squad_list: () => [makeSquad({ memberWorkspaceIds: [], leaderWorkspaceId: undefined })] });
    renderWithProviders(<SquadPanel />);
    await waitFor(() => expect(screen.getByTestId("squad-broadcast-s1")).toBeDisabled());
  });

  it("deletes a squad from the dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const calls: unknown[] = [];
    mockInvoke({
      squad_list: () => [makeSquad()],
      squad_delete: (args) => { calls.push(args); return { ok: true }; },
    });
    renderWithProviders(<SquadPanel />);
    await waitFor(() => expect(screen.getByTestId("squad-card-s1")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("squad-edit-s1"));
    await userEvent.click(await screen.findByTestId("squad-delete"));
    await waitFor(() => expect(calls).toEqual([{ id: "s1" }]));
    confirmSpy.mockRestore();
  });

  it("refresh button reloads the list", async () => {
    mockInvoke();
    renderWithProviders(<SquadPanel />);
    await waitFor(() => expect(screen.getByTestId("squad-empty")).toBeInTheDocument());
    const before = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "squad_list").length;
    await userEvent.click(screen.getByTestId("squad-refresh"));
    await waitFor(() => {
      const after = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "squad_list").length;
      expect(after).toBeGreaterThan(before);
    });
  });
});
