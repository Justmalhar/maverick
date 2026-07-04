import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ModelMenu, ReasoningMenu } from "./ComposerMenus";

describe("ModelMenu / ReasoningMenu", () => {
  it("shows the current model label and fires onSelect", async () => {
    const onSelect = vi.fn();
    render(
      <ModelMenu
        value="claude-opus-4-8"
        options={[{ id: "default", label: "Default" }, { id: "claude-opus-4-8", label: "Opus 4.8" }]}
        onSelect={onSelect}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /opus 4.8/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Default" }));
    expect(onSelect).toHaveBeenCalledWith("default");
  });

  it("reasoning menu falls back to Default label when value is null", async () => {
    render(<ReasoningMenu value={null} options={[{ id: "default", label: "Default" }, { id: "high", label: "High" }]} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /default/i })).toBeInTheDocument();
  });
});
