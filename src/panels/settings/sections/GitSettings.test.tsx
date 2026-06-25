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
});
