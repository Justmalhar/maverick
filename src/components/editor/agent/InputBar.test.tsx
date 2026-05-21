import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import { InputBar } from "./InputBar";
import { useWorkbench } from "@/state/store";
import { makeSkill, makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
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
});
