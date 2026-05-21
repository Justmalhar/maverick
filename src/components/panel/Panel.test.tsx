import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { Panel } from "./Panel";

describe("Panel", () => {
  it("renders placeholders when tab switches", async () => {
    renderWithProviders(<Panel />);
    expect(screen.getByText(/Run repository setup/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("panel-tab-run"));
    expect(screen.getByText(/Process output for dev servers/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("panel-tab-setup"));
    expect(screen.getByText(/Run repository setup/)).toBeInTheDocument();
  });
});
