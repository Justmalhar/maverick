import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { invoke } from "@tauri-apps/api/core";
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

  it("New Skill button opens the skill-editor system tab", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    renderWithProviders(<SkillsPanel />);
    await waitFor(() => expect(screen.getByTestId("skills-panel-new")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("skills-panel-new"));
    await waitFor(() =>
      expect(useWorkbench.getState().systemTabs).toContain("skill-editor")
    );
  });
});
