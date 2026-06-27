import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { ConnectHostDialog } from "./ConnectHostDialog";

function mockInvoke(overrides: Record<string, (args?: unknown) => unknown> = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (overrides[cmd]) return overrides[cmd](args) as never;
    switch (cmd) {
      case "git_credential_status":
        return { provider: "github", connected: false } as never;
      case "git_credential_connect":
        return { username: "octocat" } as never;
      case "git_credential_disconnect":
        return { ok: true } as never;
      default:
        return undefined as never;
    }
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("ConnectHostDialog", () => {
  it("shows the credential form when the host is not connected", async () => {
    mockInvoke();
    renderWithProviders(
      <ConnectHostDialog open onOpenChange={() => {}} defaultProvider="bitbucket" />
    );
    expect(await screen.findByTestId("connect-username")).toBeInTheDocument();
    expect(screen.getByTestId("connect-password")).toBeInTheDocument();
    expect(screen.getByTestId("connect-submit")).toBeDisabled();
  });

  it("validates and stores a credential, then shows connected state", async () => {
    let connected = false;
    mockInvoke({
      git_credential_status: () =>
        connected
          ? { provider: "github", connected: true, username: "octocat" }
          : { provider: "github", connected: false },
      git_credential_connect: () => {
        connected = true;
        return { username: "octocat" };
      },
    });
    const onChanged = vi.fn();
    renderWithProviders(
      <ConnectHostDialog open onOpenChange={() => {}} defaultProvider="github" onChanged={onChanged} />
    );
    await userEvent.type(await screen.findByTestId("connect-username"), "octocat");
    await userEvent.type(screen.getByTestId("connect-password"), "ghp_token");
    await userEvent.click(screen.getByTestId("connect-submit"));

    expect(await screen.findByTestId("connect-status-connected")).toHaveTextContent(
      "Connected to GitHub as octocat"
    );
    expect(invoke).toHaveBeenCalledWith("git_credential_connect", {
      provider: "github",
      username: "octocat",
      password: "ghp_token",
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("surfaces a validation error without storing", async () => {
    mockInvoke({
      git_credential_connect: () => {
        throw new Error("Bitbucket rejected the credentials (HTTP 401)");
      },
    });
    renderWithProviders(
      <ConnectHostDialog open onOpenChange={() => {}} defaultProvider="bitbucket" />
    );
    await userEvent.type(await screen.findByTestId("connect-username"), "alice");
    await userEvent.type(screen.getByTestId("connect-password"), "wrong");
    await userEvent.click(screen.getByTestId("connect-submit"));
    expect(await screen.findByTestId("connect-error")).toHaveTextContent("HTTP 401");
  });

  it("offers Disconnect when already connected", async () => {
    mockInvoke({
      git_credential_status: () => ({ provider: "github", connected: true, username: "octocat" }),
    });
    renderWithProviders(<ConnectHostDialog open onOpenChange={() => {}} defaultProvider="github" />);
    const disconnect = await screen.findByTestId("connect-disconnect");
    await userEvent.click(disconnect);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("git_credential_disconnect", {
        provider: "github",
        username: "octocat",
      })
    );
  });

  it("switches provider and reloads status", async () => {
    mockInvoke();
    renderWithProviders(<ConnectHostDialog open onOpenChange={() => {}} defaultProvider="github" />);
    await screen.findByTestId("connect-username");
    await userEvent.click(screen.getByTestId("connect-provider-gitlab"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("git_credential_status", { provider: "gitlab" })
    );
  });

  it("refreshStatus catch: surfaces error when git_credential_status throws (lines 73-74)", async () => {
    mockInvoke({
      git_credential_status: () => {
        throw new Error("status-check-failed");
      },
    });
    renderWithProviders(
      <ConnectHostDialog open onOpenChange={() => {}} defaultProvider="github" />
    );
    expect(await screen.findByTestId("connect-error")).toHaveTextContent("status-check-failed");
  });

  it("onDisconnect catch: surfaces error when git_credential_disconnect throws (line 116)", async () => {
    mockInvoke({
      git_credential_status: () => ({ provider: "github", connected: true, username: "octocat" }),
      git_credential_disconnect: () => {
        throw new Error("disconnect-failed");
      },
    });
    renderWithProviders(<ConnectHostDialog open onOpenChange={() => {}} defaultProvider="github" />);
    await screen.findByTestId("connect-disconnect");
    await userEvent.click(screen.getByTestId("connect-disconnect"));
    expect(await screen.findByTestId("connect-error")).toHaveTextContent("disconnect-failed");
  });
});
