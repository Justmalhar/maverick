import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, fireEvent, waitFor } from "@/test/utils";
import { InputBar } from "./InputBar";
import { useWorkbench } from "@/state/store";
import { useSettingsStore, _resetSettingsStoreForTests } from "@/lib/stores/settings";
import { makeBackend, makeSkill, makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

function pasteText(el: Element, text: string) {
  fireEvent.paste(el, { clipboardData: { getData: () => text } });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  _resetSettingsStoreForTests();
  useWorkbench.setState({
    ...initial,
    skills: [
      makeSkill({ name: "review", description: "Review the diff" }),
      makeSkill({ name: "refactor", description: "Refactor code" }),
      makeSkill({ name: "test", description: "Add tests" }),
    ],
  });
});

describe("InputBar", () => {
  it("submits trimmed text and clears the field on Enter", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={onSubmit} />);
    const ta = screen.getByLabelText("Prompt input") as HTMLTextAreaElement;
    await userEvent.type(ta, "hello{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("hello");
    expect(ta.value).toBe("");
  });

  it("Enter on empty text is a no-op", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={onSubmit} />);
    const ta = screen.getByLabelText("Prompt input");
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("send button submits and ignores empty text", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByTestId("input-send"));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Prompt input"), "ok");
    await userEvent.click(screen.getByTestId("input-send"));
    expect(onSubmit).toHaveBeenCalledWith("ok");
  });

  it("opens skill autocomplete on '/' and navigates with arrow keys", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={onSubmit} />);
    const ta = screen.getByLabelText("Prompt input");
    await userEvent.type(ta, "/r");
    expect(await screen.findByTestId("skill-autocomplete")).toBeInTheDocument();
    fireEvent.keyDown(ta, { key: "ArrowDown" });
    fireEvent.keyDown(ta, { key: "ArrowUp" });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect((ta as HTMLTextAreaElement).value).toContain("/review ");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Escape closes the skill autocomplete", async () => {
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={() => {}} />);
    const ta = screen.getByLabelText("Prompt input");
    await userEvent.type(ta, "/re");
    expect(await screen.findByTestId("skill-autocomplete")).toBeInTheDocument();
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(screen.queryByTestId("skill-autocomplete")).not.toBeInTheDocument();
  });

  it("clicking a skill in the autocomplete inserts it", async () => {
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={() => {}} />);
    const ta = screen.getByLabelText("Prompt input") as HTMLTextAreaElement;
    await userEvent.type(ta, "/re");
    const item = await screen.findByText("/review");
    fireEvent.mouseDown(item);
    expect(ta.value).toContain("/review ");
  });

  it("does not open autocomplete when there is no slash trigger", async () => {
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={() => {}} />);
    await userEvent.type(screen.getByLabelText("Prompt input"), "no slash here");
    expect(screen.queryByTestId("skill-autocomplete")).not.toBeInTheDocument();
  });

  it("Enter when filteredSkills is empty does not submit (skillOpen gates)", async () => {
    useWorkbench.setState({ ...initial, skills: [] });
    const onSubmit = vi.fn();
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Prompt input"), "/missing{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("small pastes do not create an attachment", () => {
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={() => {}} />);
    pasteText(screen.getByLabelText("Prompt input"), "short paste");
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.queryByTestId("attachment-chips")).not.toBeInTheDocument();
  });

  it("large pastes (> threshold) convert to an attachment chip and insert the ref", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      filePath: "/wt/.maverick/attachments/123.txt",
      ref: "@attachment:123.txt",
    } as never);
    renderWithProviders(
      <InputBar workspace={makeWorkspace({ id: "w1", worktreePath: "/wt" })} onSubmit={() => {}} />
    );
    const ta = screen.getByLabelText("Prompt input") as HTMLTextAreaElement;
    pasteText(ta, "x".repeat(6000));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("attachment_create", {
        worktreePath: "/wt",
        text: "x".repeat(6000),
      })
    );
    expect(await screen.findByTestId("attachment-chip-@attachment:123.txt")).toBeInTheDocument();
    expect(screen.getByText("6.0k chars")).toBeInTheDocument();
    expect(ta.value).toContain("@attachment:123.txt");
  });

  it("removing an attachment chip strips the ref from the input", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      filePath: "/wt/.maverick/attachments/123.txt",
      ref: "@attachment:123.txt",
    } as never);
    renderWithProviders(
      <InputBar workspace={makeWorkspace({ id: "w1", worktreePath: "/wt" })} onSubmit={() => {}} />
    );
    const ta = screen.getByLabelText("Prompt input") as HTMLTextAreaElement;
    pasteText(ta, "y".repeat(6000));
    await screen.findByTestId("attachment-chip-@attachment:123.txt");

    await userEvent.click(screen.getByTestId("attachment-remove-@attachment:123.txt"));
    expect(screen.queryByTestId("attachment-chip-@attachment:123.txt")).not.toBeInTheDocument();
    expect(ta.value).not.toContain("@attachment:123.txt");
  });

  it("logs an error and adds no chip when attachment creation fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
    renderWithProviders(
      <InputBar workspace={makeWorkspace({ id: "w1", worktreePath: "/wt" })} onSubmit={() => {}} />
    );
    pasteText(screen.getByLabelText("Prompt input"), "z".repeat(6000));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    expect(screen.queryByTestId("attachment-chips")).not.toBeInTheDocument();
    errSpy.mockRestore();
  });

  it("respects a custom large-text threshold and formats sub-1k attachments", async () => {
    useSettingsStore.setState({
      values: { "advanced.largeTextThreshold": 100 },
      status: "idle",
      lastError: null,
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      filePath: "/wt/.maverick/attachments/s.txt",
      ref: "@attachment:s.txt",
    } as never);
    renderWithProviders(
      <InputBar workspace={makeWorkspace({ id: "w1", worktreePath: "/wt" })} onSubmit={() => {}} />
    );
    pasteText(screen.getByLabelText("Prompt input"), "a".repeat(600));
    await screen.findByTestId("attachment-chip-@attachment:s.txt");
    expect(screen.getByText("600 chars")).toBeInTheDocument();
  });

  it("maverick:input-append event with {text} shape appends text to the input", async () => {
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={() => {}} />);
    const ta = screen.getByLabelText("Prompt input") as HTMLTextAreaElement;
    fireEvent(
      window,
      new CustomEvent("maverick:input-append", { detail: { text: "injected prompt" } })
    );
    await waitFor(() => expect(ta.value).toBe("injected prompt"));
  });

  it("maverick:input-append with plain string detail appends text", async () => {
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={() => {}} />);
    const ta = screen.getByLabelText("Prompt input") as HTMLTextAreaElement;
    fireEvent(
      window,
      new CustomEvent("maverick:input-append", { detail: "plain string prompt" })
    );
    await waitFor(() => expect(ta.value).toBe("plain string prompt"));
  });

  it("maverick:input-append appends to existing input with a newline separator", async () => {
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={() => {}} />);
    const ta = screen.getByLabelText("Prompt input") as HTMLTextAreaElement;
    await userEvent.type(ta, "existing text");
    fireEvent(
      window,
      new CustomEvent("maverick:input-append", { detail: { text: "appended" } })
    );
    await waitFor(() => expect(ta.value).toBe("existing text\nappended"));
  });

  it("maverick:input-append with empty text is a no-op", async () => {
    renderWithProviders(<InputBar workspace={makeWorkspace({ id: "w1" })} onSubmit={() => {}} />);
    const ta = screen.getByLabelText("Prompt input") as HTMLTextAreaElement;
    fireEvent(
      window,
      new CustomEvent("maverick:input-append", { detail: { text: "" } })
    );
    expect(ta.value).toBe("");
  });

  it("submitting clears attachment chips", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      filePath: "/wt/.maverick/attachments/123.txt",
      ref: "@attachment:123.txt",
    } as never);
    const onSubmit = vi.fn();
    renderWithProviders(
      <InputBar workspace={makeWorkspace({ id: "w1", worktreePath: "/wt" })} onSubmit={onSubmit} />
    );
    const ta = screen.getByLabelText("Prompt input") as HTMLTextAreaElement;
    pasteText(ta, "q".repeat(6000));
    await screen.findByTestId("attachment-chip-@attachment:123.txt");

    await userEvent.type(ta, " review this");
    await userEvent.click(screen.getByTestId("input-send"));
    expect(onSubmit).toHaveBeenCalled();
    expect(screen.queryByTestId("attachment-chips")).not.toBeInTheDocument();
  });

  describe("backend selector", () => {
    it("hides the selector when there are 0 backends", () => {
      useWorkbench.setState({ ...initial, skills: [], backends: [] });
      renderWithProviders(
        <InputBar workspace={makeWorkspace({ id: "w1", agentBackend: "claude" })} onSubmit={() => {}} />
      );
      expect(screen.queryByTestId("input-backend-select")).not.toBeInTheDocument();
    });

    it("hides the selector when there is exactly 1 backend", () => {
      useWorkbench.setState({
        ...initial,
        skills: [],
        backends: [makeBackend({ id: "claude", name: "claude" })],
      });
      renderWithProviders(
        <InputBar workspace={makeWorkspace({ id: "w1", agentBackend: "claude" })} onSubmit={() => {}} />
      );
      expect(screen.queryByTestId("input-backend-select")).not.toBeInTheDocument();
    });

    it("shows the selector and fires onBackendChange when multiple backends exist", async () => {
      useWorkbench.setState({
        ...initial,
        skills: [],
        backends: [
          makeBackend({ id: "claude", name: "claude" }),
          makeBackend({ id: "codex", name: "codex", active: false }),
        ],
      });
      const onBackendChange = vi.fn();
      renderWithProviders(
        <InputBar
          workspace={makeWorkspace({ id: "w1", agentBackend: "claude" })}
          onSubmit={() => {}}
          onBackendChange={onBackendChange}
        />
      );
      expect(screen.getByTestId("input-backend-select")).toBeInTheDocument();
      // Open the select and pick "codex"
      await userEvent.click(screen.getByTestId("input-backend-select"));
      await userEvent.click(screen.getByText("codex"));
      expect(onBackendChange).toHaveBeenCalledWith("codex");
    });
  });
});
