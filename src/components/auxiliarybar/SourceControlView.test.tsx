import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { __resetAutoFetchForTests } from "@/hooks/useSourceControl";
import { SourceControlView } from "./SourceControlView";

const initial = useWorkbench.getState();

const WS = {
  id: "w1",
  projectId: "p1",
  branch: "viper",
  agentBackend: "claude-code",
  worktreePath: "/wt",
  status: "active" as const,
  sessionId: "s1",
};

const FILES = [
  { path: "src/a.ts", status: "M" as const, additions: 3, deletions: 1, hunks: [] },
  { path: "src/b.ts", status: "A" as const, additions: 10, deletions: 0, hunks: [] },
];

function mockInvoke(overrides: Record<string, (args?: unknown) => unknown> = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (overrides[cmd]) return overrides[cmd](args) as never;
    switch (cmd) {
      case "diff_get":
        return { files: FILES } as never;
      case "git_branch_list":
        return [
          { name: "viper", isRemote: false, isCurrent: true, upstream: "origin/viper", ahead: 2, behind: 1 },
        ] as never;
      case "git_remote_info":
        return {
          provider: "bitbucket", host: "bitbucket.org", owner: "o", repo: "r",
          webUrl: "https://bitbucket.org/o/r", remoteUrl: "git@bitbucket.org:o/r.git",
        } as never;
      case "git_fetch":
      case "git_pull":
      case "git_push":
        return { ok: true } as never;
      default:
        return undefined as never;
    }
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  __resetAutoFetchForTests();
  useWorkbench.setState({
    ...initial,
    workspaces: [WS],
    activeWorkspaceId: "w1",
  });
});

describe("SourceControlView", () => {
  it("shows the empty state when no workspace is active", () => {
    useWorkbench.setState({ ...useWorkbench.getState(), activeWorkspaceId: null });
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    expect(screen.getByTestId("scm-empty")).toBeInTheDocument();
  });

  it("renders branch, ahead/behind, provider and the changed files", async () => {
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    await waitFor(() => expect(screen.getByTestId("scm-branch")).toHaveTextContent("viper"));
    expect(screen.getByTestId("scm-ahead")).toHaveTextContent("↑2");
    expect(screen.getByTestId("scm-behind")).toHaveTextContent("↓1");
    await waitFor(() => expect(screen.getByTestId("scm-provider")).toHaveTextContent("Bitbucket"));
    expect(await screen.findByTestId("scm-file-src/a.ts")).toBeInTheDocument();
    expect(screen.getByTestId("scm-file-src/b.ts")).toBeInTheDocument();
  });

  it("shows working-tree-clean when there are no changes", async () => {
    mockInvoke({ diff_get: () => ({ files: [] }) });
    renderWithProviders(<SourceControlView />);
    expect(await screen.findByTestId("scm-clean")).toBeInTheDocument();
  });

  it("toggles file selection", async () => {
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    const file = await screen.findByTestId("scm-file-src/a.ts");
    expect(file).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(file);
    expect(file).toHaveAttribute("aria-pressed", "false");
  });

  it("generates a commit message into the textarea", async () => {
    mockInvoke({ ai_commit_message: () => ({ message: "feat: generated" }) });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await userEvent.click(screen.getByTestId("scm-generate"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-message")).toHaveValue("feat: generated")
    );
  });

  it("surfaces a generation error as feedback", async () => {
    mockInvoke({
      ai_commit_message: () => {
        throw new Error("claude CLI failed");
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await userEvent.click(screen.getByTestId("scm-generate"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent(/claude CLI failed/)
    );
  });

  it("refuses to commit without a message", async () => {
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await userEvent.click(screen.getByTestId("scm-commit"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent(/commit message/i)
    );
  });

  it("refuses to commit with no files selected", async () => {
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    const a = await screen.findByTestId("scm-file-src/a.ts");
    const b = screen.getByTestId("scm-file-src/b.ts");
    await userEvent.click(a);
    await userEvent.click(b);
    await userEvent.type(screen.getByTestId("scm-message"), "msg");
    await userEvent.click(screen.getByTestId("scm-commit"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent(/at least one file/i)
    );
  });

  it("commits the selected files and reports the short sha", async () => {
    const calls: unknown[] = [];
    mockInvoke({
      git_commit: (args) => {
        calls.push(args);
        return { sha: "abcdef1234567890" };
      },
    });
    renderWithProviders(<SourceControlView />);
    const b = await screen.findByTestId("scm-file-src/b.ts");
    await userEvent.click(b); // commit only a.ts
    await userEvent.type(screen.getByTestId("scm-message"), "fix: a");
    await userEvent.click(screen.getByTestId("scm-commit"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent("Committed abcdef1")
    );
    expect(calls[0]).toEqual({ worktreePath: "/wt", message: "fix: a", files: ["src/a.ts"] });
  });

  it("pushes via the source-control hook and reports success", async () => {
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await userEvent.click(screen.getByTestId("scm-push"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent("Pushed.")
    );
  });

  it("surfaces a push failure", async () => {
    mockInvoke({
      git_push: () => {
        throw new Error("auth required");
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    // Wait for the branch (with upstream) to load before pushing.
    await waitFor(() => expect(screen.getByTestId("scm-ahead")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("scm-push"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent(/auth required/)
    );
  });

  it("pulls and refreshes the file list", async () => {
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await waitFor(() => expect(screen.getByTestId("scm-ahead")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("scm-pull"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent("Pulled.")
    );
  });

  it("creates a PR and links the returned URL", async () => {
    mockInvoke({ pr_create: () => ({ url: "https://bitbucket.org/o/r/pull-requests/new?source=viper" }) });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await userEvent.click(screen.getByTestId("scm-pr"));
    const link = await screen.findByTestId("scm-pr-link");
    expect(link).toHaveAttribute(
      "href",
      "https://bitbucket.org/o/r/pull-requests/new?source=viper"
    );
  });

  it("surfaces a PR failure", async () => {
    mockInvoke({
      pr_create: () => {
        throw new Error("no supported provider");
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await userEvent.click(screen.getByTestId("scm-pr"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent(/no supported provider/)
    );
  });
});
