import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import PresetForm from "./PresetForm";
import type { PresetNode } from "@/lib/ipc";

describe("PresetForm", () => {
  it("renders split node info and updates ratio", () => {
    const onChange = vi.fn();
    const node: PresetNode = {
      type: "split", direction: "h", ratio: 0.4,
      left: { type: "terminal", agent: "a", cwd: "/", mode: "agent" },
      right: { type: "terminal", agent: "b", cwd: "/", mode: "agent" },
    };
    renderWithProviders(<PresetForm node={node} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("preset-form-ratio"), { target: { value: "0.6" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ratio: 0.6 }));
  });

  it("renders browser node and converts to terminal", async () => {
    const onChange = vi.fn();
    renderWithProviders(<PresetForm node={{ type: "browser", url: "https://x" }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("preset-form-url"), { target: { value: "https://new" } });
    await userEvent.click(screen.getByText("Convert to terminal"));
    expect(onChange).toHaveBeenCalled();
  });

  it("renders terminal node with all sub-fields and toggles agent and mode + converts to browser", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PresetForm node={{ type: "terminal", agent: "claude", cwd: "/", mode: "agent" }} onChange={onChange} />
    );
    await userEvent.click(screen.getByTestId("preset-agent-codex"));
    fireEvent.change(screen.getByTestId("preset-form-cwd"), { target: { value: "/x" } });
    fireEvent.change(screen.getByTestId("preset-form-startup"), { target: { value: "claude --c" } });
    await userEvent.click(screen.getByTestId("preset-mode-terminal"));
    await userEvent.click(screen.getByText("Convert to browser"));
    expect(onChange).toHaveBeenCalled();
  });
});
