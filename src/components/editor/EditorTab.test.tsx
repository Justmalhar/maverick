import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, within } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/utils";
import { EditorTab } from "./EditorTab";
import { useWorkbench } from "@/state/store";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, editorModes: {} });
  useAgentStatusStore.setState({ statuses: {} });
});

describe("EditorTab", () => {
  it("renders title/branch and invokes select + close", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <EditorTab workspace={makeWorkspace({ id: "w1", title: undefined, branch: "feat", status: "active" })}
        active onSelect={onSelect} onClose={onClose} />
    );
    const tab = screen.getByTestId("editor-tab-w1");
    expect(tab).toHaveTextContent("feat");
    await userEvent.click(tab);
    expect(onSelect).toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText("Close workspace"));
    expect(onClose).toHaveBeenCalled();
  });

  it("wears the backend brand mark in agent mode and the terminal glyph in terminal mode", () => {
    const ws = makeWorkspace({ id: "w1", agentBackend: "claude-code" });
    const { rerender } = renderWithProviders(
      <EditorTab workspace={ws} active onSelect={() => {}} onClose={() => {}} />
    );
    expect(screen.getByTestId("editor-tab-brand-w1")).toHaveAttribute("title", "Claude Code");

    useWorkbench.setState({ ...initial, editorModes: { w1: "terminal" } });
    rerender(<EditorTab workspace={ws} active onSelect={() => {}} onClose={() => {}} />);
    expect(screen.queryByTestId("editor-tab-brand-w1")).not.toBeInTheDocument();
  });

  it("falls back to the generic icon for an unknown backend", () => {
    renderWithProviders(
      <EditorTab
        workspace={makeWorkspace({ id: "w2", agentBackend: "mystery-cli" })}
        active
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.queryByTestId("editor-tab-brand-w2")).not.toBeInTheDocument();
  });

  it("shows terminal icon when mode is terminal and reflects the agent status", () => {
    useWorkbench.setState({ ...initial, editorModes: { w1: "terminal" } });
    useAgentStatusStore.setState({ statuses: { w1: "error" } });
    renderWithProviders(
      <EditorTab workspace={makeWorkspace({ id: "w1", status: "error", title: "T" })}
        active={false} onSelect={() => {}} onClose={() => {}} />
    );
    const tab = screen.getByTestId("editor-tab-w1");
    expect(tab).toHaveAttribute("data-active", "false");
    expect(within(tab).getByTestId("agent-status-pill")).toHaveAttribute("data-status", "error");
  });

  it("defaults to an idle agent-status pill when the workspace is untracked", () => {
    renderWithProviders(
      <EditorTab workspace={makeWorkspace({ id: "w1", status: "idle" })}
        active={false} onSelect={() => {}} onClose={() => {}} />
    );
    const tab = screen.getByTestId("editor-tab-w1");
    expect(within(tab).getByTestId("agent-status-pill")).toHaveAttribute("data-status", "idle");
  });

  it("renders the working agent-status when output is flowing", () => {
    useAgentStatusStore.setState({ statuses: { w1: "working" } });
    renderWithProviders(
      <EditorTab workspace={makeWorkspace({ id: "w1" })}
        active={false} onSelect={() => {}} onClose={() => {}} />
    );
    const tab = screen.getByTestId("editor-tab-w1");
    expect(within(tab).getByTestId("agent-status-pill")).toHaveAttribute("data-status", "working");
  });

  it("Enter key on tab triggers onSelect", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <EditorTab workspace={makeWorkspace({ id: "w1" })}
        active={false} onSelect={onSelect} onClose={() => {}} />
    );
    fireEvent.keyDown(screen.getByTestId("editor-tab-w1"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalled();
  });

  it("Space key on tab triggers onSelect", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <EditorTab workspace={makeWorkspace({ id: "w1" })}
        active={false} onSelect={onSelect} onClose={() => {}} />
    );
    fireEvent.keyDown(screen.getByTestId("editor-tab-w1"), { key: " " });
    expect(onSelect).toHaveBeenCalled();
  });
});
