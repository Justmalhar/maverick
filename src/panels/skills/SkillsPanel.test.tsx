import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { invoke } from "@tauri-apps/api/core";
import * as framerMotion from "framer-motion";
import SkillsPanel from "./SkillsPanel";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, skills: [], systemTabs: [], activeSystemTab: null });
});

describe("SkillsPanel", () => {
  it("renders the panel with header", () => {
    vi.mocked(invoke).mockResolvedValue([]);
    renderWithProviders(<SkillsPanel />);
    expect(screen.getByTestId("skills-panel")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
  });

  it("shows empty state when no skills are loaded", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    renderWithProviders(<SkillsPanel />);
    await waitFor(() => expect(screen.getByTestId("skills-panel-empty")).toBeInTheDocument());
  });

  it("renders skill rows after load", async () => {
    vi.mocked(invoke).mockResolvedValue([
      { name: "refactor", description: "Refactors code", prompt: "p" },
      { name: "test-gen", description: "Generates tests", prompt: "q" },
    ]);
    renderWithProviders(<SkillsPanel />);
    await waitFor(() => expect(screen.getByTestId("skills-panel-row-refactor")).toBeInTheDocument());
    expect(screen.getByTestId("skills-panel-row-test-gen")).toBeInTheDocument();
    expect(screen.getByText("Refactors code")).toBeInTheDocument();
  });

  it("refresh button re-calls skills_list_global", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    renderWithProviders(<SkillsPanel />);
    await waitFor(() => expect(screen.getByTestId("skills-panel-empty")).toBeInTheDocument());
    const callsBefore = vi.mocked(invoke).mock.calls.length;
    await userEvent.click(screen.getByTestId("skills-panel-refresh"));
    expect(vi.mocked(invoke).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("logs and keeps rendering when skills_list_global fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("sidecar down"));
    renderWithProviders(<SkillsPanel />);
    await waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith("skillsListGlobal failed", expect.any(Error))
    );
    expect(screen.getByTestId("skills-panel")).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it("New Skill button opens the editor in create mode (clears any draft)", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    useWorkbench.setState({ editingSkill: { name: "old", description: "d", prompt: "p" } });
    renderWithProviders(<SkillsPanel />);
    await waitFor(() => expect(screen.getByTestId("skills-panel-new")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("skills-panel-new"));
    await waitFor(() => expect(useWorkbench.getState().systemTabs).toContain("skill-editor"));
    expect(useWorkbench.getState().editingSkill).toBeNull();
  });

  it("clicking a skill row loads it into the editor", async () => {
    vi.mocked(invoke).mockResolvedValue([
      { name: "refactor", description: "Refactors code", prompt: "do it", backend: "claude-code" },
    ]);
    renderWithProviders(<SkillsPanel />);
    await userEvent.click(await screen.findByTestId("skills-panel-row-refactor"));
    await waitFor(() => expect(useWorkbench.getState().systemTabs).toContain("skill-editor"));
    expect(useWorkbench.getState().editingSkill?.name).toBe("refactor");
  });

  it("skill row without a description omits the description paragraph", async () => {
    vi.mocked(invoke).mockResolvedValue([
      { name: "nodesc", description: "", prompt: "p" },
    ]);
    renderWithProviders(<SkillsPanel />);
    await waitFor(() => expect(screen.getByTestId("skills-panel-row-nodesc")).toBeInTheDocument());
    // When description is empty the second <p> element is not rendered.
    const row = screen.getByTestId("skills-panel-row-nodesc");
    const paras = row.querySelectorAll("p");
    // Only the name paragraph, not the description paragraph.
    expect(paras).toHaveLength(1);
  });

  it("skill row with a description renders it", async () => {
    vi.mocked(invoke).mockResolvedValue([
      { name: "withdesc", description: "Does something useful", prompt: "p" },
    ]);
    renderWithProviders(<SkillsPanel />);
    await waitFor(() => expect(screen.getByText("Does something useful")).toBeInTheDocument());
  });

  it("renders with reduced-motion preference (animate undefined branch)", async () => {
    const spy = vi.spyOn(framerMotion, "useReducedMotion").mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue([]);
    try {
      renderWithProviders(<SkillsPanel />);
      expect(screen.getByTestId("skills-panel")).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});
