import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import GitSettings from "./GitSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("GitSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

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
});
