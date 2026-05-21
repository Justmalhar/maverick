import { describe, it, expect, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { render, screen } from "@testing-library/react";
import App from "./App";

vi.mocked(invoke).mockResolvedValue([] as never);

describe("App", () => {
  it("renders the workbench inside ThemeProvider + TooltipProvider", () => {
    render(<App />);
    expect(screen.getByTestId("workbench")).toBeInTheDocument();
  });
});
