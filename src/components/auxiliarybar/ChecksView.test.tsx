import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { ChecksView } from "./ChecksView";
import { useWorkbench } from "@/state/store";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";
import { makeWorkspace } from "@/test/fixtures";
import type { ChecksReport } from "@/lib/ipc";

const initial = useWorkbench.getState();

function report(over: Partial<ChecksReport> = {}): ChecksReport {
  return {
    git: { branch: "feat", ahead: 0, behind: 0, changedFiles: 0, conflicts: 0 },
    pr: null,
    ghAvailable: true,
    checks: [],
    merge: { ready: true, blockers: [] },
    ...over,
  };
}

function activeWorkspace() {
  useWorkbench.setState({
    ...initial,
    workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt" })],
    activeWorkspaceId: "w1",
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useAgentStatusStore.setState({ statuses: {} });
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChecksView", () => {
  it("shows empty state without an active workspace", () => {
    renderWithProviders(<ChecksView />);
    expect(screen.getByTestId("checks-empty")).toBeInTheDocument();
  });

  it("renders a ready-to-merge banner when there are no blockers", async () => {
    activeWorkspace();
    vi.mocked(invoke).mockResolvedValueOnce(report() as never);
    renderWithProviders(<ChecksView />);
    const banner = await screen.findByTestId("checks-merge");
    expect(banner).toHaveAttribute("data-ready", "true");
    expect(banner).toHaveTextContent(/ready to merge/i);
  });

  it("lists every blocker when not ready", async () => {
    activeWorkspace();
    vi.mocked(invoke).mockResolvedValueOnce(
      report({
        git: { branch: "feat", ahead: 0, behind: 3, changedFiles: 1, conflicts: 0 },
        merge: {
          ready: false,
          blockers: ["1 uncommitted change", "behind upstream by 3", "no pull request open"],
        },
      }) as never
    );
    renderWithProviders(<ChecksView />);
    const banner = await screen.findByTestId("checks-merge");
    expect(banner).toHaveAttribute("data-ready", "false");
    expect(screen.getByText("1 uncommitted change")).toBeInTheDocument();
    expect(screen.getByText("behind upstream by 3")).toBeInTheDocument();
    expect(screen.getByText("no pull request open")).toBeInTheDocument();
  });

  it("shows git ahead/behind and change counts", async () => {
    activeWorkspace();
    vi.mocked(invoke).mockResolvedValueOnce(
      report({
        git: { branch: "feat", ahead: 2, behind: 1, changedFiles: 4, conflicts: 1 },
        merge: { ready: false, blockers: ["x"] },
      }) as never
    );
    renderWithProviders(<ChecksView />);
    const git = await screen.findByTestId("checks-git");
    expect(git).toHaveTextContent("feat");
    expect(git).toHaveTextContent("↑2");
    expect(git).toHaveTextContent("↓1");
  });

  it("renders a PR link when a pull request exists", async () => {
    activeWorkspace();
    vi.mocked(invoke).mockResolvedValueOnce(
      report({
        pr: {
          number: 7,
          url: "https://github.com/o/r/pull/7",
          state: "OPEN",
          title: "Add feature",
          mergeable: "MERGEABLE",
        },
      }) as never
    );
    renderWithProviders(<ChecksView />);
    const link = await screen.findByTestId("checks-pr-link");
    expect(link).toHaveAttribute("href", "https://github.com/o/r/pull/7");
    expect(link).toHaveTextContent("#7");
  });

  it("renders normalized check rows with status", async () => {
    activeWorkspace();
    vi.mocked(invoke).mockResolvedValueOnce(
      report({
        pr: { number: 1, url: "u", state: "OPEN", title: "t", mergeable: "MERGEABLE" },
        checks: [
          { name: "build", status: "pass" },
          { name: "test", status: "fail" },
          { name: "e2e", status: "pending" },
          { name: "lint", status: "neutral", detail: "skipped" },
        ],
        merge: { ready: false, blockers: ["1 failing check"] },
      }) as never
    );
    renderWithProviders(<ChecksView />);
    expect(await screen.findByTestId("checks-item-build")).toHaveAttribute("data-status", "pass");
    expect(screen.getByTestId("checks-item-test")).toHaveAttribute("data-status", "fail");
    expect(screen.getByTestId("checks-item-e2e")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("checks-item-lint")).toHaveAttribute("data-status", "neutral");
    expect(screen.getByText("skipped")).toBeInTheDocument();
  });

  it("hints to configure gh when it is unavailable", async () => {
    activeWorkspace();
    vi.mocked(invoke).mockResolvedValueOnce(report({ ghAvailable: false }) as never);
    renderWithProviders(<ChecksView />);
    expect(await screen.findByTestId("checks-gh-unavailable")).toBeInTheDocument();
  });

  it("re-fetches when the refresh button is clicked", async () => {
    activeWorkspace();
    vi.mocked(invoke)
      .mockResolvedValueOnce(report({ git: { branch: "feat", ahead: 0, behind: 0, changedFiles: 0, conflicts: 0 } }) as never)
      .mockResolvedValueOnce(report({ git: { branch: "feat", ahead: 9, behind: 0, changedFiles: 0, conflicts: 0 }, merge: { ready: false, blockers: ["x"] } }) as never);
    renderWithProviders(<ChecksView />);
    await screen.findByTestId("checks-git");
    await userEvent.click(screen.getByTestId("checks-refresh"));
    await waitFor(() => expect(screen.getByTestId("checks-git")).toHaveTextContent("↑9"));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("checks_get", { worktreePath: "/wt" });
  });

  it("shows an error state when the fetch fails", async () => {
    activeWorkspace();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
    renderWithProviders(<ChecksView />);
    expect(await screen.findByTestId("checks-error")).toBeInTheDocument();
  });
});
