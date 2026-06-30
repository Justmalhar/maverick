import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { EditorArea } from "./EditorArea";
import { useWorkbench } from "@/state/store";
import * as prewarm from "@/lib/viewers/prewarm";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
});

describe("EditorArea", () => {
  it("renders the editor area shell", () => {
    renderWithProviders(<EditorArea />);
    expect(screen.getByTestId("editor-area")).toBeInTheDocument();
  });

  it("prewarms the editor (Monaco + viewer chunks) on mount", () => {
    const spy = vi.spyOn(prewarm, "prewarmEditor").mockImplementation(() => {});
    try {
      renderWithProviders(<EditorArea />);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});
