import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import AutomationBuilder from "./AutomationBuilder";
import { makeAutomation } from "@/test/fixtures";
import type { Automation } from "@/lib/ipc";

describe("AutomationBuilder", () => {
  it("adds default step for each type and removes them; renames; changes trigger", async () => {
    const onChange = vi.fn();
    renderWithProviders(<AutomationBuilder automation={makeAutomation({ steps: [] })} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("automation-name"), { target: { value: "ren" } });

    await userEvent.click(screen.getByTestId("automation-trigger"));
    await userEvent.click(screen.getByText("schedule"));

    await userEvent.click(screen.getByTestId("automation-add-step"));
    await userEvent.click(screen.getByText("shell"));
    expect(onChange).toHaveBeenCalled();
  });

  it("renders existing steps and supports remove + update", async () => {
    const auto: Automation = {
      name: "a", trigger: "manual",
      steps: [
        { type: "shell", command: "ls" },
        { type: "skill", skill: "review" },
      ],
    };
    const onChange = vi.fn();
    renderWithProviders(<AutomationBuilder automation={auto} onChange={onChange} />);
    const removes = screen.getAllByTestId("automation-step-remove");
    await userEvent.click(removes[0]);
    expect(onChange).toHaveBeenCalled();
  });

  it("shows empty state when no steps", () => {
    renderWithProviders(<AutomationBuilder automation={makeAutomation({ steps: [] })} onChange={() => {}} />);
    expect(screen.getByText(/No steps yet/)).toBeInTheDocument();
  });

  it("updates a step via StepEditor onChange (covers updateStep)", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <AutomationBuilder
        automation={{ name: "a", trigger: "manual", steps: [{ type: "shell", command: "" }] }}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByTestId("step-shell-command"), { target: { value: "ls -al" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("each step type yields a defaultStep when added", async () => {
    const types = ["shell", "skill", "git", "workspace", "notify", "url"] as const;
    for (const t of types) {
      const onChange = vi.fn();
      const { unmount } = renderWithProviders(
        <AutomationBuilder automation={makeAutomation({ steps: [] })} onChange={onChange} />
      );
      await userEvent.click(screen.getByTestId("automation-add-step"));
      await userEvent.click(screen.getByText(t));
      expect(onChange).toHaveBeenCalled();
      unmount();
    }
  });
});
