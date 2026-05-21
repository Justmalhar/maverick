import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import StepEditor from "./StepEditor";
import type { AutomationStep } from "@/lib/ipc";

function each(step: AutomationStep, tid: string) {
  const onChange = vi.fn();
  renderWithProviders(<StepEditor step={step} onChange={onChange} />);
  fireEvent.change(screen.getByTestId(tid), { target: { value: "x" } });
  expect(onChange).toHaveBeenCalled();
}

describe("StepEditor", () => {
  it("renders shell step", () => each({ type: "shell", command: "" }, "step-shell-command"));
  it("renders skill step", () => each({ type: "skill", skill: "" }, "step-skill-name"));
  it("renders git step", () => {
    const onChange = vi.fn();
    renderWithProviders(<StepEditor step={{ type: "git", action: "push" }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("step-git-action"), { target: { value: "pull" } });
    fireEvent.change(screen.getByTestId("step-git-remote"), { target: { value: "origin" } });
    fireEvent.change(screen.getByTestId("step-git-branch"), { target: { value: "main" } });
    expect(onChange).toHaveBeenCalledTimes(3);
  });
  it("renders workspace step", () => {
    const onChange = vi.fn();
    renderWithProviders(<StepEditor step={{ type: "workspace", action: "create" }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("step-workspace-action"), { target: { value: "destroy" } });
    fireEvent.change(screen.getByTestId("step-workspace-branch"), { target: { value: "x" } });
  });
  it("renders notify step", () => {
    const onChange = vi.fn();
    renderWithProviders(<StepEditor step={{ type: "notify", title: "", body: "" }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("step-notify-title"), { target: { value: "t" } });
    fireEvent.change(screen.getByTestId("step-notify-body"), { target: { value: "b" } });
  });
  it("renders url step", () => each({ type: "url", url: "" }, "step-url"));
  it("falls through to null for unknown type", () => {
    const { container } = renderWithProviders(
      <StepEditor step={{ type: "unknown" } as unknown as AutomationStep} onChange={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
