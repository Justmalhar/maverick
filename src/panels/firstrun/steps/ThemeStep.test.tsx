import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { ThemeStep } from "./ThemeStep";
import { ThemeProvider } from "@/themes/theme-provider";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ThemeStep", () => {
  it("renders a card for every bundled theme", () => {
    render(
      <ThemeProvider>
        <ThemeStep />
      </ThemeProvider>
    );
    expect(screen.getAllByRole("button", { name: /apply theme/i }).length).toBeGreaterThanOrEqual(12);
  });

  it("clicking a theme card calls bootstrap_update_settings with that theme name", async () => {
    mockInvoke.mockResolvedValueOnce({ theme: "dracula" });
    render(
      <ThemeProvider>
        <ThemeStep />
      </ThemeProvider>
    );
    const dracula = screen.getByRole("button", { name: /apply theme dracula/i });
    await userEvent.click(dracula);
    expect(mockInvoke).toHaveBeenCalledWith(
      "bootstrap_update_settings",
      expect.objectContaining({ patch: expect.objectContaining({ theme: "dracula" }) })
    );
  });
});
