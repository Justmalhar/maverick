import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { invoke } from "@tauri-apps/api/core";
import SkillEditorPanel from "./SkillEditorPanel";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({
    ...initial,
    skills: [],
    systemTabs: ["skill-editor"],
    activeSystemTab: "skill-editor",
  });
});

describe("SkillEditorPanel", () => {
  it("renders the editor with the template pre-filled", () => {
    renderWithProviders(<SkillEditorPanel />);
    expect(screen.getByTestId("skill-editor-panel")).toBeInTheDocument();
    const ta = screen.getByTestId("skill-editor-textarea") as HTMLTextAreaElement;
    expect(ta.value).toContain("name: my-skill");
    expect(ta.value).toContain("---");
  });

  it("cancel button closes the skill-editor tab", async () => {
    renderWithProviders(<SkillEditorPanel />);
    await userEvent.click(screen.getByTestId("skill-editor-cancel"));
    expect(useWorkbench.getState().systemTabs).not.toContain("skill-editor");
  });

  it("save calls skills_create_global with parsed frontmatter then closes tab", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, filePath: "/tmp/my-skill.md" }) // create
      .mockResolvedValueOnce([ // list reload
        { name: "my-skill", description: "My desc", prompt: "p" },
      ]);

    renderWithProviders(<SkillEditorPanel />);
    await userEvent.click(screen.getByTestId("skill-editor-save"));

    await waitFor(() =>
      expect(useWorkbench.getState().systemTabs).not.toContain("skill-editor")
    );
    expect(invoke).toHaveBeenCalledWith("skills_create_global", expect.objectContaining({ name: "my-skill" }));
  });

  it("shows an error when frontmatter has no name", async () => {
    renderWithProviders(<SkillEditorPanel />);
    const ta = screen.getByTestId("skill-editor-textarea");
    await userEvent.clear(ta);
    await userEvent.type(ta, "no frontmatter here");
    await userEvent.click(screen.getByTestId("skill-editor-save"));
    await waitFor(() =>
      expect(screen.getByTestId("skill-editor-error")).toBeInTheDocument()
    );
  });

  it("shows an error when the IPC call throws", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
    renderWithProviders(<SkillEditorPanel />);
    await userEvent.click(screen.getByTestId("skill-editor-save"));
    await waitFor(() =>
      expect(screen.getByTestId("skill-editor-error")).toBeInTheDocument()
    );
  });

  it("save button is not disabled initially", () => {
    renderWithProviders(<SkillEditorPanel />);
    expect(screen.getByTestId("skill-editor-save")).not.toBeDisabled();
  });
});
