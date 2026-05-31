import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { AgentStatusPill } from "./AgentStatusPill";
import type { AgentStatus } from "@/hooks/useAgentStatus";

const CASES: Array<[AgentStatus, string]> = [
  ["idle", "Idle"],
  ["working", "Working"],
  ["attention", "Attention"],
  ["done", "Done"],
  ["error", "Error"],
];

describe("AgentStatusPill", () => {
  it.each(CASES)("renders %s with its label and data-status", (status, label) => {
    renderWithProviders(<AgentStatusPill status={status} />);
    const pill = screen.getByTestId("agent-status-pill");
    expect(pill).toHaveAttribute("data-status", status);
    expect(pill).toHaveAttribute("title", `Agent: ${label}`);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("hides the label in compact mode but keeps the dot + data-status", () => {
    renderWithProviders(<AgentStatusPill status="working" compact />);
    const pill = screen.getByTestId("agent-status-pill");
    expect(pill).toHaveAttribute("data-status", "working");
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
  });

  it("applies a passed className", () => {
    renderWithProviders(<AgentStatusPill status="idle" className="mv-test-pill" />);
    expect(screen.getByTestId("agent-status-pill")).toHaveClass("mv-test-pill");
  });
});
