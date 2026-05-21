import { describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { EditorArea } from "./EditorArea";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, workspaces: [], activeWorkspaceId: null });
});

describe("EditorArea", () => {
  it("renders the editor area shell", () => {
    renderWithProviders(<EditorArea />);
    expect(screen.getByTestId("editor-area")).toBeInTheDocument();
  });
});
