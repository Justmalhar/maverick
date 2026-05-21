import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import AccountSettings from "./AccountSettings";

describe("AccountSettings", () => {
  it("renders Free / Pro and switches channels", async () => {
    renderWithProviders(<AccountSettings />);
    expect(screen.getByTestId("account-plan")).toHaveTextContent("Free");
    fireEvent.change(screen.getByTestId("account-license"), { target: { value: "XXXX" } });
    expect(screen.getByTestId("account-plan")).toHaveTextContent("Pro");
    await userEvent.click(screen.getByTestId("channel-beta"));
    await userEvent.click(screen.getByTestId("channel-stable"));
  });
});
