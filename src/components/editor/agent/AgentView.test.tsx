import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { AgentView } from "./AgentView";
import { makeMessage, makeWorkspace } from "@/test/fixtures";
import { useWorkbench } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  useWorkbench.setState({ ...initial, skills: [] });
  useProjectSettingsStore.getState().reset();
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
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "messages_list") return Promise.resolve([]);
      if (cmd === "message_append") return Promise.reject(new Error("nope"));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1" })} />);
    await userEvent.type(screen.getByLabelText("Prompt input"), "x{Enter}");
    await waitFor(() => expect(errSpy).toHaveBeenCalledWith("submit failed", expect.any(Error)));
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

  it("ignores a late messages_list resolve after unmount", async () => {
    let resolveList!: (v: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise((res) => { resolveList = res; }) as never
    );
    const { unmount } = renderWithProviders(
      <AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1" })} />
    );
    unmount();
    resolveList([makeMessage({ id: "late" })]);
    await Promise.resolve();
    expect(screen.queryByTestId("message-agent-late")).not.toBeInTheDocument();
  });

  it("ignores a late messages_list rejection after unmount", async () => {
    let rejectList!: (e: Error) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise((_, rej) => { rejectList = rej; }) as never
    );
    const { unmount } = renderWithProviders(
      <AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1" })} />
    );
    unmount();
    rejectList(new Error("late"));
    await Promise.resolve();
    expect(true).toBe(true);
  });

  it("prepends resolved instructions to the first prompt of a fresh session", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "messages_list") return Promise.resolve([]);
      if (cmd === "instructions_resolve")
        return Promise.resolve({ global: "GLOBAL", project: "PROJECT", projectSource: "MAVERICK.md" });
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1", worktreePath: "/wt" })} />);
    await userEvent.type(screen.getByLabelText("Prompt input"), "do it{Enter}");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("instructions_resolve", { worktreePath: "/wt" })
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "w1", data: "GLOBAL\n\nPROJECT\n\ndo it\n" })
    );
    // The persisted/visible message stays clean (no preamble).
    expect(invoke).toHaveBeenCalledWith("message_append", expect.objectContaining({ content: "do it" }));
  });

  it("does not inject instructions when the session already has history", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "messages_list") return Promise.resolve([makeMessage({ id: "m1", content: "earlier" })]);
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1", worktreePath: "/wt" })} />);
    await waitFor(() => expect(screen.getByText("earlier")).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText("Prompt input"), "next{Enter}");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "w1", data: "next\n" })
    );
    expect(invoke).not.toHaveBeenCalledWith("instructions_resolve", expect.anything());
  });

  it("only injects instructions once per session even across multiple prompts", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "messages_list") return Promise.resolve([]);
      if (cmd === "instructions_resolve")
        return Promise.resolve({ global: "", project: "RULES", projectSource: "MAVERICK.md" });
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1", worktreePath: "/wt" })} />);
    const ta = screen.getByLabelText("Prompt input");
    await userEvent.type(ta, "first{Enter}");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "w1", data: "RULES\n\nfirst\n" })
    );
    await userEvent.type(ta, "second{Enter}");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "w1", data: "second\n" })
    );
    const resolveCalls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "instructions_resolve");
    expect(resolveCalls).toHaveLength(1);
  });

  it("falls back to a clean prompt when instruction resolution fails", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "messages_list") return Promise.resolve([]);
      if (cmd === "instructions_resolve") return Promise.reject(new Error("no sidecar"));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1", worktreePath: "/wt" })} />);
    await userEvent.type(screen.getByLabelText("Prompt input"), "hello{Enter}");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_write", { ptyId: "w1", data: "hello\n" })
    );
  });

  it("appends preferences.general to the preamble when set", async () => {
    useProjectSettingsStore.setState({
      projectId: "proj-1",
      status: "loaded",
      data: {
        name: "demo",
        rootPath: "/tmp/demo",
        workspaces: { branchFrom: "main", filesToCopy: [] },
        remote: "",
        previewUrl: "",
        scripts: { setup: "", run: "", archive: "" },
        preferences: { general: "Always add tests." },
      },
      dirty: {},
      lastError: null,
    });
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "messages_list") return Promise.resolve([]);
      if (cmd === "instructions_resolve")
        return Promise.resolve({ global: "GLOBAL", project: "", projectSource: null });
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1", worktreePath: "/wt" })} />);
    await userEvent.type(screen.getByLabelText("Prompt input"), "do it{Enter}");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_write",
        expect.objectContaining({
          data: expect.stringContaining("--- Project Preferences ---\nAlways add tests."),
        })
      )
    );
  });

  it("does not append a preferences block when preferences.general is empty or unset", async () => {
    useProjectSettingsStore.setState({
      projectId: "proj-1",
      status: "loaded",
      data: {
        name: "demo",
        rootPath: "/tmp/demo",
        workspaces: { branchFrom: "main", filesToCopy: [] },
        remote: "",
        previewUrl: "",
        scripts: { setup: "", run: "", archive: "" },
        preferences: { general: "" },
      },
      dirty: {},
      lastError: null,
    });
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "messages_list") return Promise.resolve([]);
      if (cmd === "instructions_resolve")
        return Promise.resolve({ global: "GLOBAL", project: "", projectSource: null });
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    renderWithProviders(<AgentView workspace={makeWorkspace({ id: "w1", sessionId: "s1", worktreePath: "/wt" })} />);
    await userEvent.type(screen.getByLabelText("Prompt input"), "do it{Enter}");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pty_write", expect.objectContaining({
        data: "GLOBAL\n\ndo it\n",
      }))
    );
    const ptyCalls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "pty_write");
    expect(ptyCalls[0]?.[1]).not.toHaveProperty("data", expect.stringContaining("--- Project Preferences ---"));
  });
});
