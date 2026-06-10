import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, act, createEvent } from "@testing-library/react";
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

  it("shows branch error in select placeholder when gitBranches fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("branch fail"));
    setup();
    await userEvent.click(screen.getByTestId("composer-project"));
    await userEvent.click(await screen.findByText("Alpha"));
    await waitFor(() =>
      expect(screen.getByTestId("composer-branch")).toHaveTextContent("Could not load branches")
    );
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
        baseBranch: "main",
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

  it("dragOver adds ring style to composer", () => {
    setup();
    const composer = screen.getByTestId("task-composer");
    fireEvent.dragOver(composer);
    expect(composer.className).toContain("ring-1");
  });

  it("dragLeave removes ring style from composer", () => {
    setup();
    const composer = screen.getByTestId("task-composer");
    fireEvent.dragOver(composer);
    expect(composer.className).toContain("ring-1");
    fireEvent.dragLeave(composer);
    expect(composer.className).not.toContain("ring-1");
  });

  it("drop with text file creates a utf8 attachment", async () => {
    setup();
    const composer = screen.getByTestId("task-composer");
    const mockFile = { name: "notes.txt", type: "text/plain", size: 100, text: vi.fn().mockResolvedValue("hello content"), arrayBuffer: vi.fn() };
    const dropEv = createEvent.drop(composer);
    Object.defineProperty(dropEv, "dataTransfer", { value: { files: [mockFile] } });
    await act(async () => fireEvent(composer, dropEv));
    await waitFor(() => expect(screen.getByTestId("composer-attachment")).toBeInTheDocument());
    expect(screen.getByTestId("composer-attachment").textContent).toContain("notes.txt");
  });

  it("drop with binary file creates a base64 attachment", async () => {
    setup();
    const composer = screen.getByTestId("task-composer");
    const buf = new Uint8Array([0, 1, 2]).buffer;
    const mockFile = { name: "image.png", type: "image/png", size: 3, text: vi.fn(), arrayBuffer: vi.fn().mockResolvedValue(buf) };
    const dropEv = createEvent.drop(composer);
    Object.defineProperty(dropEv, "dataTransfer", { value: { files: [mockFile] } });
    await act(async () => fireEvent(composer, dropEv));
    await waitFor(() => expect(screen.getByTestId("composer-attachment")).toBeInTheDocument());
    expect(screen.getByTestId("composer-attachment").textContent).toContain("image.png");
  });

  it("drop with oversized file shows error and no attachment", async () => {
    setup();
    const composer = screen.getByTestId("task-composer");
    const mockFile = { name: "huge.bin", type: "application/octet-stream", size: 3 * 1024 * 1024, text: vi.fn(), arrayBuffer: vi.fn() };
    const dropEv = createEvent.drop(composer);
    Object.defineProperty(dropEv, "dataTransfer", { value: { files: [mockFile] } });
    await act(async () => fireEvent(composer, dropEv));
    await waitFor(() => expect(screen.getByTestId("composer-error")).toBeInTheDocument());
    expect(screen.getByTestId("composer-error").textContent).toContain("too large");
    expect(screen.queryByTestId("composer-attachment")).not.toBeInTheDocument();
  });

  it("defaultProjectId pre-populates project and fetches branches", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["main", "dev"] as never);
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "Alpha", path: "/alpha" })],
      backends: [makeBackend({ id: "claude", name: "Claude", active: true })],
    });
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TaskComposer onSend={onSend} defaultProjectId="p1" />);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("git_branches", { projectPath: "/alpha" })
    );
    expect(screen.getByTestId("composer-project")).toHaveTextContent("Alpha");
  });

  it("defaultProjectId null does not auto-populate project", () => {
    vi.mocked(invoke).mockReset();
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "Alpha", path: "/alpha" })],
      backends: [makeBackend({ id: "claude", name: "Claude", active: true })],
    });
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TaskComposer onSend={onSend} defaultProjectId={null} />);
    expect(invoke).not.toHaveBeenCalledWith("git_branches", expect.anything());
  });

  it("re-populates when defaultProjectId changes to a different project", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [
        makeProject({ id: "p1", name: "Alpha", path: "/alpha" }),
        makeProject({ id: "p2", name: "Beta", path: "/beta" }),
      ],
      backends: [makeBackend({ id: "claude", name: "Claude", active: true })],
    });
    vi.mocked(invoke)
      .mockResolvedValueOnce(["main"] as never)
      .mockResolvedValueOnce(["feat"] as never);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderWithProviders(
      <TaskComposer onSend={onSend} defaultProjectId="p1" />
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("git_branches", { projectPath: "/alpha" })
    );

    rerender(<TaskComposer onSend={onSend} defaultProjectId="p2" />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("git_branches", { projectPath: "/beta" })
    );
    expect(screen.getByTestId("composer-project")).toHaveTextContent("Beta");
  });
});
