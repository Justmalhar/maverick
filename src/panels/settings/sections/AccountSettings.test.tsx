import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import AccountSettings from "./AccountSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("AccountSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("edits license, switches channel via select", async () => {
    renderWithProviders(<AccountSettings />);
    fireEvent.change(screen.getByTestId("account-license"), { target: { value: "ABCD-EFGH-IJKL-MNOP" } });
    expect(screen.getByTestId("account-license")).toHaveValue("ABCD-EFGH-IJKL-MNOP");
    expect(screen.getByTestId("account-plan")).toHaveTextContent(/Pro/i);

    await userEvent.click(screen.getByRole("combobox", { name: /update channel/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Beta" }));
    expect(screen.getByRole("combobox", { name: /update channel/i })).toHaveTextContent("Beta");
  });
});
