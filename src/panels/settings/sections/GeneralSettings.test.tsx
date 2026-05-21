import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import GeneralSettings from "./GeneralSettings";

describe("GeneralSettings", () => {
  it("renders and lets user edit all fields including restore toggle", async () => {
    renderWithProviders(<GeneralSettings />);
    fireEvent.change(screen.getByTestId("general-default-backend"), { target: { value: "codex" } });
    fireEvent.change(screen.getByTestId("general-default-branch"), { target: { value: "develop" } });
    fireEvent.change(screen.getByTestId("general-naming"), { target: { value: "{backend}" } });
    await userEvent.click(screen.getByTestId("general-restore"));
    expect(screen.getByTestId("general-restore")).toHaveTextContent("Off");
  });
});
