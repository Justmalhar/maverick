import { describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { AgentOutputView } from "./AgentOutputView";
import { useWorkbench } from "@/state/store";
import { useAgentOutput } from "@/lib/stores/agent-output";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
  useAgentOutput.setState({ runs: {} });
});

function activeWorkspace() {
  useWorkbench.setState({
    ...initial,
    workspaces: [makeWorkspace({ id: "w1" })],
    activeWorkspaceId: "w1",
  });
}

describe("AgentOutputView", () => {
  it("shows empty state without an active workspace", () => {
    renderWithProviders(<AgentOutputView />);
    expect(screen.getByTestId("agent-output-empty")).toBeInTheDocument();
  });

  it("shows an idle hint when the active workspace has no output", () => {
    activeWorkspace();
    renderWithProviders(<AgentOutputView />);
    expect(screen.getByTestId("agent-output-idle")).toBeInTheDocument();
  });

  it("renders lines by kind and a running indicator", () => {
    activeWorkspace();
    const s = useAgentOutput.getState();
    s.start("w1");
    s.appendLine("w1", { kind: "text", text: "Looking at the code" });
    s.appendLine("w1", { kind: "tool", text: "Edit src/app.ts" });
    s.appendLine("w1", { kind: "stderr", text: "a warning" });
    renderWithProviders(<AgentOutputView />);
    expect(screen.getByText("Looking at the code")).toBeInTheDocument();
    expect(screen.getByText("Edit src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("a warning")).toBeInTheDocument();
    expect(screen.getByTestId("agent-output-running")).toBeInTheDocument();
  });

  it("shows done + cost after the run finishes", () => {
    activeWorkspace();
    const s = useAgentOutput.getState();
    s.appendLine("w1", { kind: "result", text: "All set." });
    s.finish("w1", { costUsd: 0.042 });
    renderWithProviders(<AgentOutputView />);
    expect(screen.getByTestId("agent-output-done")).toBeInTheDocument();
    expect(screen.getByTestId("agent-output-cost")).toHaveTextContent("$0.042");
  });

  it("marks an error result line distinctly", () => {
    activeWorkspace();
    useAgentOutput.getState().appendLine("w1", { kind: "result", text: "failed", isError: true });
    renderWithProviders(<AgentOutputView />);
    expect(screen.getByTestId("agent-line-result")).toHaveTextContent("failed");
  });
});
