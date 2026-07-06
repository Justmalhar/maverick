import { describe, it, test, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { useWorkbench, fileTabId } from "@/state/store";
import { __resetAutoFetchForTests } from "@/hooks/useSourceControl";
import { useSettingsStore } from "@/lib/stores/settings";
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
      case "git_branch_create":
      case "git_checkout":
        return { ok: true } as never;
      case "git_credential_status":
        return { provider: "bitbucket", connected: false } as never;
      default:
        return undefined as never;
    }
  });
}

// Open the Git actions dropdown so its menu items become reachable.
async function openActions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("scm-actions-trigger"));
  await screen.findByTestId("scm-action-push");
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  __resetAutoFetchForTests();
  useWorkbench.setState({
    ...initial,
    workspaces: [WS],
    activeWorkspaceId: "w1",
  });
  useSettingsStore.setState({ values: {} });
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
    await waitFor(() => expect(screen.getByTestId("scm-connect")).toHaveTextContent("Connect Bitbucket"));
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
    await userEvent.click(file);
    expect(file).toHaveAttribute("aria-pressed", "true");
  });

  it("refresh button reloads files and remote state", async () => {
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    const diffCallsBefore = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "diff_get").length;
    await userEvent.click(screen.getByTestId("scm-refresh"));
    await waitFor(() => {
      const diffCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "diff_get").length;
      expect(diffCalls).toBeGreaterThan(diffCallsBefore);
    });
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

  test("generates a commit message via the workspace agent backend", async () => {
    const calls: unknown[] = [];
    mockInvoke({
      ai_commit_message: (args) => {
        calls.push(args);
        return { message: "feat: x" };
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await userEvent.click(screen.getByTestId("scm-generate"));
    await waitFor(() => expect(calls).toHaveLength(1));
    // aiCommitMessage(worktreePath, agentBackend) → invoke args carry both.
    expect(calls[0]).toEqual({ worktreePath: "/wt", backend: "claude-code" });
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

  it("refuses to commit without a message (via Git actions Commit)", async () => {
    const user = userEvent.setup();
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await openActions(user);
    await user.click(screen.getByTestId("scm-action-commit"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent(/commit message/i)
    );
  });

  it("refuses to commit with no files selected", async () => {
    const user = userEvent.setup();
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    const a = await screen.findByTestId("scm-file-src/a.ts");
    const b = screen.getByTestId("scm-file-src/b.ts");
    await user.click(a);
    await user.click(b);
    await user.type(screen.getByTestId("scm-message"), "msg");
    await openActions(user);
    await user.click(screen.getByTestId("scm-action-commit"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent(/at least one file/i)
    );
  });

  test("primary action commits with the entered message", async () => {
    const calls: unknown[] = [];
    mockInvoke({
      git_commit: (args) => {
        calls.push(args);
        return { sha: "abc1234def5678" };
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await userEvent.type(screen.getByTestId("scm-message"), "feat: x");
    await userEvent.click(screen.getByTestId("scm-primary"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      worktreePath: "/wt",
      message: "feat: x",
      files: ["src/a.ts", "src/b.ts"],
      gpgSign: false,
    });
  });

  it("commits the selected files via Git actions Commit and reports the short sha", async () => {
    const user = userEvent.setup();
    const calls: unknown[] = [];
    mockInvoke({
      git_commit: (args) => {
        calls.push(args);
        return { sha: "abcdef1234567890" };
      },
    });
    renderWithProviders(<SourceControlView />);
    const b = await screen.findByTestId("scm-file-src/b.ts");
    await user.click(b); // commit only a.ts
    await user.type(screen.getByTestId("scm-message"), "fix: a");
    await openActions(user);
    await user.click(screen.getByTestId("scm-action-commit"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent("Committed abcdef1")
    );
    expect(calls[0]).toEqual({ worktreePath: "/wt", message: "fix: a", files: ["src/a.ts"], gpgSign: false });
  });

  it("Commit & Push primary action commits then pushes", async () => {
    const commits: unknown[] = [];
    mockInvoke({
      git_commit: (args) => {
        commits.push(args);
        return { sha: "abcdef1234567890" };
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    // Branch has an upstream → primary label is "Commit & Push".
    await waitFor(() => expect(screen.getByTestId("scm-primary")).toHaveTextContent("Commit & Push"));
    await userEvent.type(screen.getByTestId("scm-message"), "fix: cp");
    await userEvent.click(screen.getByTestId("scm-primary"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent("Committed abcdef1 · pushed")
    );
    expect(commits).toHaveLength(1);
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "git_push")).toBe(true);
  });

  it("pushes via the Git actions menu and reports success", async () => {
    const user = userEvent.setup();
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await openActions(user);
    await user.click(screen.getByTestId("scm-action-push"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent("Pushed.")
    );
  });

  it("surfaces a push failure", async () => {
    const user = userEvent.setup();
    mockInvoke({
      git_push: () => {
        throw new Error("auth required");
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await waitFor(() => expect(screen.getByTestId("scm-ahead")).toBeInTheDocument());
    await openActions(user);
    await user.click(screen.getByTestId("scm-action-push"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent(/auth required/)
    );
  });

  it("pulls and refreshes the file list", async () => {
    const user = userEvent.setup();
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await waitFor(() => expect(screen.getByTestId("scm-ahead")).toBeInTheDocument());
    await openActions(user);
    await user.click(screen.getByTestId("scm-action-pull"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent("Pulled.")
    );
  });

  it("surfaces a pull failure", async () => {
    const user = userEvent.setup();
    mockInvoke({
      git_pull: () => {
        throw new Error("merge conflict");
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await waitFor(() => expect(screen.getByTestId("scm-ahead")).toBeInTheDocument());
    await openActions(user);
    await user.click(screen.getByTestId("scm-action-pull"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent(/merge conflict/)
    );
  });

  it("creates a PR via the Git actions menu and links the returned URL", async () => {
    const user = userEvent.setup();
    mockInvoke({ pr_create: () => ({ url: "https://bitbucket.org/o/r/pull-requests/new?source=viper" }) });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await openActions(user);
    await user.click(screen.getByTestId("scm-action-pr-direct"));
    const link = await screen.findByTestId("scm-pr-link");
    expect(link).toHaveAttribute(
      "href",
      "https://bitbucket.org/o/r/pull-requests/new?source=viper"
    );
  });

  it("surfaces a PR failure", async () => {
    const user = userEvent.setup();
    mockInvoke({
      pr_create: () => {
        throw new Error("no supported provider");
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await openActions(user);
    await user.click(screen.getByTestId("scm-action-pr-direct"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent(/no supported provider/)
    );
  });

  it("keeps the changes list and commit UI after opening a diff (activeWorkspaceId cleared)", async () => {
    mockInvoke();
    useWorkbench.setState({
      ...useWorkbench.getState(),
      fileTabs: [],
      activeFileTabId: null,
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await userEvent.type(screen.getByTestId("scm-message"), "fix: stay put");

    // Opening a diff clears activeWorkspaceId (the editor shows the diff, not the
    // workspace). The panel must recover its worktree from the active file tab
    // instead of collapsing to the empty state.
    await userEvent.click(screen.getByTestId("scm-open-diff-src/a.ts"));

    expect(screen.queryByTestId("scm-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("scm-file-src/a.ts")).toBeInTheDocument();
    expect(screen.getByTestId("scm-message")).toHaveValue("fix: stay put");
  });

  it("clicking the file name opens a diff tab without affecting staging selection", async () => {
    mockInvoke();
    useWorkbench.setState({
      ...useWorkbench.getState(),
      fileTabs: [],
      activeFileTabId: null,
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    expect(screen.getByTestId("scm-file-src/a.ts")).toHaveAttribute("aria-pressed", "true");

    const openDiffBtn = screen.getByTestId("scm-open-diff-src/a.ts");
    await userEvent.click(openDiffBtn);

    const state = useWorkbench.getState();
    expect(state.fileTabs).toHaveLength(1);
    expect(state.fileTabs[0]).toMatchObject({
      id: fileTabId("diff", "/wt/src/a.ts"),
      kind: "diff",
      path: "/wt/src/a.ts",
      worktreePath: "/wt",
      preview: true,
    });
    expect(screen.queryByTestId("scm-empty")).not.toBeInTheDocument();
  });

  it("opens the Connect dialog from the provider header button", async () => {
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await userEvent.click(await screen.findByTestId("scm-connect"));
    expect(await screen.findByTestId("connect-host-dialog")).toBeInTheDocument();
  });

  it("shows a Connect shortcut when a push fails with an auth error", async () => {
    const user = userEvent.setup();
    mockInvoke({
      git_push: () => {
        throw new Error("authentication required: could not read Username for https://bitbucket.org");
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await openActions(user);
    await user.click(screen.getByTestId("scm-action-push"));
    const shortcut = await screen.findByTestId("scm-feedback-connect");
    expect(shortcut).toHaveTextContent("Connect Bitbucket");
    await user.click(shortcut);
    expect(await screen.findByTestId("connect-host-dialog")).toBeInTheDocument();
  });

  it("reflects an already-connected host in the header", async () => {
    mockInvoke({ git_credential_status: () => ({ provider: "bitbucket", connected: true, username: "alice" }) });
    renderWithProviders(<SourceControlView />);
    // Wait on the definitive connected signal (absence of "Connect ") rather than
    // the "Bitbucket" substring, which is also present in the transient
    // "Connect Bitbucket" label before refreshAuth resolves — a race under load.
    await waitFor(() =>
      expect(screen.getByTestId("scm-connect")).not.toHaveTextContent("Connect Bitbucket")
    );
    expect(screen.getByTestId("scm-connect")).toHaveTextContent("Bitbucket");
  });

  it("shows disconnected state when gitCredentialStatus throws (refreshAuth catch branch)", async () => {
    mockInvoke({
      git_credential_status: () => {
        throw new Error("cred check failed");
      },
    });
    renderWithProviders(<SourceControlView />);
    await waitFor(() =>
      expect(screen.getByTestId("scm-connect")).toHaveTextContent("Connect Bitbucket")
    );
  });

  it("onChanged callback triggers refreshAuth after a successful connect (line 487 function)", async () => {
    let connected = false;
    mockInvoke({
      git_credential_status: () => ({ provider: "bitbucket", connected, username: connected ? "alice" : undefined }),
      git_credential_connect: () => {
        connected = true;
        return { username: "alice" };
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");

    await userEvent.click(await screen.findByTestId("scm-connect"));
    expect(await screen.findByTestId("connect-host-dialog")).toBeInTheDocument();

    await userEvent.type(await screen.findByTestId("connect-username"), "alice");
    await userEvent.type(screen.getByTestId("connect-password"), "mytoken");
    await userEvent.click(screen.getByTestId("connect-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("scm-connect")).toHaveTextContent("Bitbucket")
    );
    expect(screen.getByTestId("scm-connect")).not.toHaveTextContent("Connect Bitbucket");
  });

  it("renames the branch with AI when pendingAiRename is set", async () => {
    useWorkbench.setState({
      ...useWorkbench.getState(),
      pendingAiRename: ["w1"],
    });
    const renames: unknown[] = [];
    mockInvoke({
      git_commit: () => ({ sha: "abc1234def5678" }),
      ai_branch_name_from_diff: () => ({ name: "feat/smart-name" }),
      git_rename_branch: (args) => {
        renames.push(args);
        return { ok: true, branch: "feat/smart-name" };
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await userEvent.type(screen.getByTestId("scm-message"), "fix: ai rename");
    await userEvent.click(screen.getByTestId("scm-primary"));
    await waitFor(() => expect(renames).toHaveLength(1));
    // pendingAiRename cleared after commit
    expect(useWorkbench.getState().pendingAiRename).not.toContain("w1");
  });

  it("prefills the commit message from the git.template setting", async () => {
    useSettingsStore.setState({ values: { "git.template": "type(scope): " } });
    mockInvoke();
    renderWithProviders(<SourceControlView />);
    await waitFor(() => expect(screen.getByTestId("scm-message")).toHaveValue("type(scope): "));
  });

  it("passes gpgSign through to git_commit when git.gpgSign is enabled", async () => {
    useSettingsStore.setState({ values: { "git.gpgSign": true } });
    const calls: unknown[] = [];
    mockInvoke({
      git_commit: (args) => {
        calls.push(args);
        return { sha: "abc1234def5678" };
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await userEvent.type(screen.getByTestId("scm-message"), "feat: signed");
    await userEvent.click(screen.getByTestId("scm-primary"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ gpgSign: true });
  });

  it("creates a branch via the Git actions menu", async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("feat/new");
    const created: unknown[] = [];
    mockInvoke({
      git_branch_create: (args) => {
        created.push(args);
        return { ok: true };
      },
    });
    renderWithProviders(<SourceControlView />);
    await screen.findByTestId("scm-file-src/a.ts");
    await openActions(user);
    await user.click(screen.getByTestId("scm-action-branch"));
    await waitFor(() =>
      expect(screen.getByTestId("scm-feedback")).toHaveTextContent("Created feat/new")
    );
    expect(created[0]).toEqual({ worktreePath: "/wt", name: "feat/new" });
    promptSpy.mockRestore();
  });
});
