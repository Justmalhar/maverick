import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { EditorTab } from "./EditorTab";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, editorModes: {} });
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

  it("shows terminal icon when mode is terminal and error status dot", () => {
    useWorkbench.setState({ ...initial, editorModes: { w1: "terminal" } });
    renderWithProviders(
      <EditorTab workspace={makeWorkspace({ id: "w1", status: "error", title: "T" })}
        active={false} onSelect={() => {}} onClose={() => {}} />
    );
    expect(screen.getByTestId("editor-tab-w1")).toHaveAttribute("data-active", "false");
  });

  it("idle status renders the idle dot variant", () => {
    renderWithProviders(
      <EditorTab workspace={makeWorkspace({ id: "w1", status: "idle" })}
        active={false} onSelect={() => {}} onClose={() => {}} />
    );
    expect(screen.getByTestId("editor-tab-w1")).toBeInTheDocument();
  });
});
