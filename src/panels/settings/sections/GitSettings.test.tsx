import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, fireEvent, waitFor } from "@/test/utils";
import GitSettings from "./GitSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("GitSettings", () => {
  beforeEach(() => {
    _resetSettingsStoreForTests();
    vi.mocked(invoke).mockReset();
  });

  it("edits remote, template, auto-fetch, and toggles GPG", async () => {
    renderWithProviders(<GitSettings />);
    fireEvent.change(screen.getByTestId("git-remote"), { target: { value: "upstream" } });
    expect(screen.getByTestId("git-remote")).toHaveValue("upstream");

    fireEvent.change(screen.getByTestId("git-template"), { target: { value: "feat: \n\nWhy:" } });
    expect(screen.getByTestId("git-template")).toHaveValue("feat: \n\nWhy:");

    fireEvent.change(screen.getByTestId("git-autofetch"), { target: { value: "10" } });
    expect(screen.getByTestId("git-autofetch")).toHaveValue(10);

    const gpg = screen.getByRole("switch", { name: /gpg signing/i });
    expect(gpg).not.toBeChecked();
    await userEvent.click(gpg);
    expect(gpg).toBeChecked();
  });

  it("lists git host accounts and opens the connect dialog", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "git_credential_status") {
        const provider = (args as { provider: string }).provider;
        return (provider === "github"
          ? { provider, connected: true, username: "octocat" }
          : { provider, connected: false }) as never;
      }
      return undefined as never;
    });
    renderWithProviders(<GitSettings />);

    // GitHub reports connected → "Manage"; Bitbucket not connected → "Connect".
    await waitFor(() => expect(screen.getByTestId("git-account-github")).toHaveTextContent("Manage"));
    expect(screen.getByTestId("git-account-bitbucket")).toHaveTextContent("Connect");

    await userEvent.click(screen.getByTestId("git-account-bitbucket"));
    expect(await screen.findByTestId("connect-host-dialog")).toBeInTheDocument();
  });

  it("gracefully handles gitCredentialStatus errors (catch branch)", async () => {
    // All providers throw — the catch branch returns { provider, connected: false }.
    vi.mocked(invoke).mockRejectedValue(new Error("auth unavailable"));
    renderWithProviders(<GitSettings />);
    // All accounts default to "Connect" (not-connected) despite the error.
    await waitFor(() => expect(screen.getByTestId("git-account-github")).toHaveTextContent("Connect"));
    expect(screen.getByTestId("git-account-bitbucket")).toHaveTextContent("Connect");
    expect(screen.getByTestId("git-account-gitlab")).toHaveTextContent("Connect");
  });

  it("shows username in description for a connected account", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "git_credential_status") {
        const provider = (args as { provider: string }).provider;
        return { provider, connected: true, username: "octocat" } as never;
      }
      return undefined as never;
    });
    renderWithProviders(<GitSettings />);
    // All three providers return connected+username, so getAllByText is needed.
    await waitFor(() => expect(screen.getAllByText(/Connected as octocat/)).toHaveLength(3));
  });

  it("onChanged callback refreshes accounts after a successful connect (line 148 function)", async () => {
    let connected = false;
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "git_credential_status") {
        const provider = (args as { provider: string }).provider;
        return { provider, connected, username: connected ? "octocat" : undefined } as never;
      }
      if (cmd === "git_credential_connect") {
        connected = true;
        return { username: "octocat" } as never;
      }
      return undefined as never;
    });
    renderWithProviders(<GitSettings />);
    await waitFor(() => expect(screen.getByTestId("git-account-github")).toBeInTheDocument());

    // Open the Connect dialog for GitHub
    await userEvent.click(screen.getByTestId("git-account-github"));
    expect(await screen.findByTestId("connect-host-dialog")).toBeInTheDocument();

    // Submit credentials — the dialog calls git_credential_connect, then onChanged → refreshAccounts
    await userEvent.type(await screen.findByTestId("connect-username"), "octocat");
    await userEvent.type(screen.getByTestId("connect-password"), "ghp_token");
    await userEvent.click(screen.getByTestId("connect-submit"));

    // After onChanged fires, refreshAccounts should re-query and show updated status.
    // The mock flips `connected=true` for all providers, so all three rows update.
    await waitFor(() =>
      expect(screen.getAllByText(/Connected as octocat/)).toHaveLength(3)
    );
  });

  it("closes the ConnectHostDialog via onOpenChange(false)", async () => {
    vi.mocked(invoke).mockResolvedValue({ provider: "github", connected: false } as never);
    renderWithProviders(<GitSettings />);
    await waitFor(() => expect(screen.getByTestId("git-account-github")).toBeInTheDocument());

    // Open the dialog by clicking Connect.
    await userEvent.click(screen.getByTestId("git-account-github"));
    expect(await screen.findByTestId("connect-host-dialog")).toBeInTheDocument();

    // Close it via the dialog's onOpenChange prop. The ConnectHostDialog must call
    // onOpenChange(false) when closed — simulate by pressing Escape.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("connect-host-dialog")).not.toBeInTheDocument());
  });
});
