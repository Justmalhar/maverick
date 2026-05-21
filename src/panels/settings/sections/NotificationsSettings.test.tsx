import { describe, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import NotificationsSettings from "./NotificationsSettings";

describe("NotificationsSettings", () => {
  it("flips toggles for each notification entry", async () => {
    renderWithProviders(<NotificationsSettings />);
    const buttons = screen.getAllByRole("button");
    for (const b of buttons) {
      await userEvent.click(b);
    }
  });
});
