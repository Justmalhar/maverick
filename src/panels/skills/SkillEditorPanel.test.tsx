import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor, fireEvent } from "@/test/utils";
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

  it("cancel returns to the Skills list instead of a blank editor", async () => {
    renderWithProviders(<SkillEditorPanel />);
    await userEvent.click(screen.getByTestId("skill-editor-cancel"));
    const s = useWorkbench.getState();
    expect(s.systemTabs).not.toContain("skill-editor");
    expect(s.activeSystemTab).toBe("skills");
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
      expect(useWorkbench.getState().activeSystemTab).toBe("skills")
    );
    expect(useWorkbench.getState().systemTabs).not.toContain("skill-editor");
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

  it("loads an existing skill for editing and saves it with overwrite", async () => {
    useWorkbench.setState({
      editingSkill: { name: "refactor", description: "Refactors code", prompt: "the body", backend: "codex" },
    });
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, filePath: "/tmp/refactor.md" })
      .mockResolvedValueOnce([]);
    renderWithProviders(<SkillEditorPanel />);
    const ta = screen.getByTestId("skill-editor-textarea") as HTMLTextAreaElement;
    expect(ta.value).toContain("name: refactor");
    expect(ta.value).toContain("the body");
    expect(screen.getByText(/Edit Skill/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("skill-editor-save"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "skills_create_global",
        expect.objectContaining({ name: "refactor", overwrite: true })
      )
    );
  });

  it("parseFrontmatter ignores frontmatter lines without a colon (idx === -1 branch)", async () => {
    // Construct frontmatter with a line that has no colon — parseFrontmatter must
    // skip it and still parse name: correctly.
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, filePath: "/tmp/my-skill.md" })
      .mockResolvedValueOnce([{ name: "my-skill", description: "", prompt: "p" }]);
    renderWithProviders(<SkillEditorPanel />);
    const ta = screen.getByTestId("skill-editor-textarea");
    // Use fireEvent.change to set multi-line content directly.
    fireEvent.change(ta, {
      target: { value: "---\nname: my-skill\nNOCOLONONTHISLINE\n---\n\nPrompt here" },
    });
    await userEvent.click(screen.getByTestId("skill-editor-save"));
    await waitFor(() => expect(useWorkbench.getState().activeSystemTab).toBe("skills"));
  });

  it("parseFrontmatter uses empty string when description key is absent (??'' branch)", async () => {
    // Frontmatter has name but no description → fm.description is undefined → ?? "" fires.
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, filePath: "/tmp/nodesc.md" })
      .mockResolvedValueOnce([{ name: "nodesc", description: "", prompt: "p" }]);
    renderWithProviders(<SkillEditorPanel />);
    const ta = screen.getByTestId("skill-editor-textarea");
    fireEvent.change(ta, {
      target: { value: "---\nname: nodesc\n---\n\nPrompt text" },
    });
    await userEvent.click(screen.getByTestId("skill-editor-save"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "skills_create_global",
        expect.objectContaining({ name: "nodesc", description: "" })
      )
    );
  });
});
