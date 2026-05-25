import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { AgentView } from "./AgentView";
import { makeMessage, makeWorkspace } from "@/test/fixtures";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  useWorkbench.setState({ ...initial, skills: [] });
});

describe("AgentView", () => {
  it("loads messages and renders them", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makeMessage({ id: "m1", role: "assistant", content: "hi" })] as never);
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1" })} />);
    await waitFor(() => expect(screen.getByTestId("message-agent-m1")).toBeInTheDocument());
  });

  it("optimistically appends a user message and writes to the PTY", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "messages_list") return Promise.resolve([]);
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1" })} />);
    await userEvent.type(screen.getByLabelText("Prompt input"), "hi{Enter}");
    await waitFor(() => expect(screen.getByText("hi")).toBeInTheDocument());
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("message_append", expect.objectContaining({ content: "hi" }));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("pty_write", { ptyId: "w1", data: "hi\n" });
  });

  it("logs an error if the append fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockResolvedValueOnce([] as never).mockRejectedValueOnce(new Error("nope"));
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1" })} />);
    await userEvent.type(screen.getByLabelText("Prompt input"), "x{Enter}");
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it("clears messages list when messages fetch fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("fail"));
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1" })} />);
    await waitFor(() => expect(screen.getByText("Start a conversation")).toBeInTheDocument());
  });

  it("does nothing when sessionId is empty", () => {
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "" })} />);
    expect(invoke).not.toHaveBeenCalled();
  });
});
