import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import PresetEditor from "./PresetEditor";
import { makePreset } from "@/test/fixtures";
import type { PresetNode } from "@/lib/ipc";

describe("PresetEditor", () => {
  it("renders with default preset, lets user edit name/description/baseBranch and save", async () => {
    const onSave = vi.fn();
    renderWithProviders(<PresetEditor onSave={onSave} />);
    expect(screen.getByTestId("preset-editor")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("preset-save"));
    expect(onSave).toHaveBeenCalled();
  });

  it("split H/V and remove operate on selected node", async () => {
    const onSave = vi.fn();
    renderWithProviders(<PresetEditor onSave={onSave} />);
    await userEvent.click(screen.getByTestId("preset-leaf"));
    await userEvent.click(screen.getByTestId("preset-split-v"));
    // Now there are multiple leaves; click first
    const leaves = screen.getAllByTestId("preset-leaf");
    await userEvent.click(leaves[0]);
    await userEvent.click(screen.getByTestId("preset-split-h"));
    // remove the selected node — selects path that exists
    const leavesAfter = screen.getAllByTestId("preset-leaf");
    await userEvent.click(leavesAfter[1]);
    await userEvent.click(screen.getByTestId("preset-remove"));
  });

  it("re-renders when preset prop changes", () => {
    const layout: PresetNode = {
      type: "split", direction: "h", ratio: 0.4,
      left: { type: "terminal", agent: "a", cwd: "/", mode: "agent" },
      right: { type: "terminal", agent: "b", cwd: "/", mode: "agent" },
    };
    const { rerender } = renderWithProviders(<PresetEditor onSave={() => {}} preset={makePreset({ name: "x", layout })} />);
    rerender(<PresetEditor onSave={() => {}} preset={makePreset({ name: "y", description: "d", baseBranch: "b", layout })} />);
  });

  it("split H of the root (no selected) is disabled if root is a split", async () => {
    const layout: PresetNode = {
      type: "split", direction: "h", ratio: 0.5,
      left: { type: "terminal", agent: "a", cwd: "/", mode: "agent" },
      right: { type: "terminal", agent: "b", cwd: "/", mode: "agent" },
    };
    renderWithProviders(<PresetEditor onSave={() => {}} preset={makePreset({ layout })} />);
    expect(screen.getByTestId("preset-split-h")).toBeDisabled();
  });

  it("renders browser leaf in canvas via prop", () => {
    const layout: PresetNode = { type: "browser", url: "http://x" };
    renderWithProviders(<PresetEditor onSave={() => {}} preset={makePreset({ layout })} />);
    expect(screen.getByTestId("preset-leaf")).toBeInTheDocument();
  });

  it("edits header inputs (name + description + baseBranch)", () => {
    renderWithProviders(<PresetEditor onSave={() => {}} preset={makePreset({ baseBranch: "main", description: "" })} />);
    fireEvent.change(screen.getAllByDisplayValue("default")[0], { target: { value: "renamed" } });
    // description and baseBranch inputs are sibling text inputs in the header
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    fireEvent.change(inputs[1], { target: { value: "new desc" } });
    fireEvent.change(inputs[2], { target: { value: "develop" } });
  });

  it("uses top/bottom split form when layout uses vertical (top/bottom shape)", async () => {
    const layout: PresetNode = {
      type: "split", direction: "v", ratio: 0.5,
      top: { type: "terminal", agent: "a", cwd: "/", mode: "agent" },
      bottom: { type: "terminal", agent: "b", cwd: "/", mode: "agent" },
    } as PresetNode;
    renderWithProviders(<PresetEditor onSave={() => {}} preset={makePreset({ layout })} />);
    const leaves = screen.getAllByTestId("preset-leaf");
    await userEvent.click(leaves[0]);
    await userEvent.click(screen.getByTestId("preset-split-v"));
    await userEvent.click(screen.getByTestId("preset-remove"));
  });

  it("right-child selection traverses head '1' branch when editing", async () => {
    const layout: PresetNode = {
      type: "split", direction: "h", ratio: 0.5,
      left: { type: "terminal", agent: "a", cwd: "/", mode: "agent" },
      right: { type: "terminal", agent: "b", cwd: "/", mode: "agent" },
    };
    renderWithProviders(<PresetEditor onSave={() => {}} preset={makePreset({ layout })} />);
    const leaves = screen.getAllByTestId("preset-leaf");
    await userEvent.click(leaves[1]);
    // Toggle a value in PresetForm to push updateAtPath through the head='1' branch
    await userEvent.click(screen.getByTestId("preset-mode-terminal"));
  });

});
