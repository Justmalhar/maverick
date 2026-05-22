import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { makeBackend, makeProject } from "@/test/fixtures";
import TaskComposer from "./TaskComposer";

const initial = useWorkbench.getState();

function setup() {
  useWorkbench.setState({
    ...initial,
    projects: [makeProject({ id: "p1", name: "Alpha", path: "/alpha" })],
    backends: [makeBackend({ id: "claude", name: "Claude", active: true })],
  });
  const onSend = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<TaskComposer onSend={onSend} />);
  return { onSend };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState(initial);
});

describe("TaskComposer", () => {
  it("renders composer heading and textarea", () => {
    setup();
    expect(screen.getByTestId("task-composer")).toBeInTheDocument();
    expect(screen.getByTestId("composer-prompt")).toBeInTheDocument();
  });

  it("Send is disabled when prompt is empty", () => {
    setup();
    expect(screen.getByTestId("composer-send")).toBeDisabled();
  });

  it("Send is disabled when project not selected", async () => {
    setup();
    await userEvent.type(screen.getByTestId("composer-prompt"), "do something");
    expect(screen.getByTestId("composer-send")).toBeDisabled();
  });

  it("paste under 1000 chars fills textarea normally", async () => {
    setup();
    const textarea = screen.getByTestId("composer-prompt");
    await userEvent.click(textarea);
    await userEvent.paste("short text");
    expect((textarea as HTMLTextAreaElement).value).toBe("short text");
    expect(screen.queryByTestId("composer-attachment")).not.toBeInTheDocument();
  });

  it("paste over 1000 chars creates a txt attachment and clears textarea", async () => {
    setup();
    const longText = "x".repeat(1001);
    const textarea = screen.getByTestId("composer-prompt");
    await userEvent.click(textarea);
    await userEvent.paste(longText);
    expect((textarea as HTMLTextAreaElement).value).toBe("");
    const chip = screen.getByTestId("composer-attachment");
    expect(chip.textContent).toMatch(/pasted_.*\.txt/);
  });

  it("attachment chip can be dismissed", async () => {
    setup();
    const longText = "y".repeat(1001);
    const textarea = screen.getByTestId("composer-prompt");
    await userEvent.click(textarea);
    await userEvent.paste(longText);
    await waitFor(() => expect(screen.getByTestId("composer-attachment")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("composer-remove-attachment"));
    expect(screen.queryByTestId("composer-attachment")).not.toBeInTheDocument();
  });

  it("gitBranches called when project selected", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["main", "dev"] as never);
    setup();
    const projectTrigger = screen.getByTestId("composer-project");
    await userEvent.click(projectTrigger);
    const alphaOption = await screen.findByText("Alpha");
    await userEvent.click(alphaOption);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_branches", { projectPath: "/alpha" }));
  });

  it("onSend called with correct payload and composer resets", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["main"] as never);
    const { onSend } = setup();

    await userEvent.click(screen.getByTestId("composer-project"));
    await userEvent.click(await screen.findByText("Alpha"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_branches", expect.any(Object)));

    await userEvent.click(screen.getByTestId("composer-branch"));
    await userEvent.click(await screen.findByText("main"));

    await userEvent.type(screen.getByTestId("composer-prompt"), "fix the bug");

    await waitFor(() => expect(screen.getByTestId("composer-send")).not.toBeDisabled());
    await userEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "fix the bug",
        projectId: "p1",
        branch: "main",
        agentBackend: "claude",
      })
    ));
    expect((screen.getByTestId("composer-prompt") as HTMLTextAreaElement).value).toBe("");
  });

  it("onSend failure shows inline error and preserves fields", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["main"] as never);
    const { onSend } = setup();
    onSend.mockRejectedValueOnce(new Error("workspace failed"));

    await userEvent.click(screen.getByTestId("composer-project"));
    await userEvent.click(await screen.findByText("Alpha"));
    await waitFor(() => expect(invoke).toHaveBeenCalled());

    await userEvent.click(screen.getByTestId("composer-branch"));
    await userEvent.click(await screen.findByText("main"));

    await userEvent.type(screen.getByTestId("composer-prompt"), "do work");
    await waitFor(() => expect(screen.getByTestId("composer-send")).not.toBeDisabled());
    await userEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() => expect(screen.getByTestId("composer-error")).toBeInTheDocument());
    expect((screen.getByTestId("composer-prompt") as HTMLTextAreaElement).value).toBe("do work");
  });
});
