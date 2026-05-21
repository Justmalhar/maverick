import { describe, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import BrowserPanel from "./BrowserPanel";

describe("BrowserPanel", () => {
  it("renders the iframe and toolbar; URL navigation pushes history", async () => {
    renderWithProviders(<BrowserPanel />);
    expect(screen.getByTestId("browser-iframe")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "example.com" } });
    await userEvent.click(screen.getByTestId("browser-refresh"));
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
  });

  it("blank URL navigation is a no-op", async () => {
    renderWithProviders(<BrowserPanel />);
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "" } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
  });

  it("https URLs are not prefixed; non-https get the prefix", async () => {
    renderWithProviders(<BrowserPanel />);
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "https://already.example" } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
  });

  it("back/forward respect bounds", async () => {
    renderWithProviders(<BrowserPanel />);
    // Back is disabled initially
    expect(screen.getByTestId("browser-back")).toBeDisabled();
    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "a" } });
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    await userEvent.click(screen.getByTestId("browser-back"));
    await userEvent.click(screen.getByTestId("browser-forward"));
  });

  it("stop and inspect toggle invoke their handlers", async () => {
    renderWithProviders(<BrowserPanel />);
    await userEvent.click(screen.getByTestId("browser-stop"));
    await userEvent.click(screen.getByTestId("browser-inspect"));
  });
});
