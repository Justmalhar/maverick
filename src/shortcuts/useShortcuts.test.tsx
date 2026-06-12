import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useShortcuts } from "./useShortcuts";
import { useWorkbench } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { makeWorkspace, makeDiff, makeDiffFile } from "@/test/fixtures";

const initial = useWorkbench.getState();

function resetStore() {
  useWorkbench.setState({
    ...initial,
    projects: [],
    workspaces: [],
    backends: [],
    skills: [],
    activeWorkspaceId: null,
    editorModes: {},
    splitTrees: {},
    commandPaletteOpen: false,
    quickOpenOpen: false,
    presetLauncherOpen: false,
    keybindingHelpOpen: false,
    settingsOpen: false,
    layout: {
      activitybarCollapsed: false,
      primarySideBarVisible: true,
      primarySideBarWidth: 240,
      auxiliaryBarVisible: true,
      auxiliaryBarWidth: 280,
      panelVisible: false,
      panelHeight: 220,
      auxiliaryView: "files",
    },
  });
}

function bindings(): Record<string, (e: KeyboardEvent) => void> {
  return (globalThis as Record<string, unknown>).__tinykeysBindings as Record<string, (e: KeyboardEvent) => void>;
}

function fire(combo: string) {
  const handler = bindings()[combo];
  expect(handler).toBeDefined();
  const event = { preventDefault: vi.fn() } as unknown as KeyboardEvent;
  handler(event);
}

describe("useShortcuts", () => {
  beforeEach(() => {
    resetStore();
    (globalThis as Record<string, unknown>).__tinykeysBindings = undefined;
  });

  it("registers all KEYBINDINGS and the 1-9 workspace jumps", () => {
    renderHook(() => useShortcuts());
    const b = bindings();
    expect(b["$mod+]"]).toBeTypeOf("function");
    expect(b["$mod+1"]).toBeTypeOf("function");
    expect(b["$mod+9"]).toBeTypeOf("function");
  });

  it("workspace.next / prev cycles through workspaces", () => {
    useWorkbench.getState().setWorkspaces([
      makeWorkspace({ id: "a" }), makeWorkspace({ id: "b" }), makeWorkspace({ id: "c" }),
    ]);
    useWorkbench.getState().setActiveWorkspace("a");
    renderHook(() => useShortcuts());

    act(() => fire("$mod+]"));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("b");
    act(() => fire("$mod+["));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("a");
    act(() => fire("$mod+["));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("c");
  });

  it("workspace.next / prev no-op on empty list", () => {
    renderHook(() => useShortcuts());
    act(() => fire("$mod+]"));
    act(() => fire("$mod+["));
    expect(useWorkbench.getState().activeWorkspaceId).toBeNull();
  });

  it("workspace.new and project.new open the command palette", () => {
    renderHook(() => useShortcuts());
    act(() => fire("$mod+n"));
    expect(useWorkbench.getState().commandPaletteOpen).toBe(true);
    useWorkbench.getState().setCommandPaletteOpen(false);
    act(() => fire("$mod+Shift+n"));
    expect(useWorkbench.getState().commandPaletteOpen).toBe(true);
  });

  it("workspace.close removes the active workspace, no-op when none", () => {
    useWorkbench.getState().setWorkspaces([makeWorkspace({ id: "a" })]);
    useWorkbench.getState().setActiveWorkspace("a");
    renderHook(() => useShortcuts());
    act(() => fire("$mod+w"));
    expect(useWorkbench.getState().workspaces).toHaveLength(0);
    // Repeat with no active workspace — should not throw.
    act(() => fire("$mod+w"));
  });

  it("editor.toggleMode flips the active editor mode", () => {
    useWorkbench.getState().setWorkspaces([makeWorkspace({ id: "a" })]);
    useWorkbench.getState().setActiveWorkspace("a");
    renderHook(() => useShortcuts());
    act(() => fire("$mod+t"));
    expect(useWorkbench.getState().editorModes["a"]).toBe("terminal");
    useWorkbench.getState().setActiveWorkspace(null);
    act(() => fire("$mod+t"));
  });

  it("editor.focusInput targets [data-input-bar]", () => {
    const input = document.createElement("input");
    input.setAttribute("data-input-bar", "");
    document.body.appendChild(input);
    const focusSpy = vi.spyOn(input, "focus");
    renderHook(() => useShortcuts());
    act(() => fire("$mod+l"));
    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("delegated terminal/editor handlers fire without throwing", () => {
    renderHook(() => useShortcuts());
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    act(() => fire("$mod+Shift+r"));
    act(() => fire("$mod+d"));
    act(() => fire("$mod+Shift+d"));
    act(() => fire("$mod+Shift+w"));
    act(() => fire("$mod+k"));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
  });

  it("terminal.splitH dispatches maverick:terminal:splitH", () => {
    renderHook(() => useShortcuts());
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    act(() => fire("$mod+d"));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "maverick:terminal:splitH" })
    );
  });

  it("terminal.splitV dispatches maverick:terminal:splitV", () => {
    renderHook(() => useShortcuts());
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    act(() => fire("$mod+Shift+d"));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "maverick:terminal:splitV" })
    );
  });

  it("terminal.closePane dispatches maverick:terminal:closePane", () => {
    renderHook(() => useShortcuts());
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    act(() => fire("$mod+Shift+w"));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "maverick:terminal:closePane" })
    );
  });

  it("preview.open shows the Preview aux view (revealing the bar if hidden)", () => {
    useWorkbench.setState({
      ...useWorkbench.getState(),
      layout: { ...useWorkbench.getState().layout, auxiliaryBarVisible: false },
    });
    renderHook(() => useShortcuts());
    act(() => fire("$mod+Shift+v"));
    expect(useWorkbench.getState().layout.auxiliaryView).toBe("preview");
    expect(useWorkbench.getState().layout.auxiliaryBarVisible).toBe(true);
  });

  it("preview.open keeps the bar visible when already shown", () => {
    renderHook(() => useShortcuts());
    act(() => fire("$mod+Shift+v"));
    expect(useWorkbench.getState().layout.auxiliaryView).toBe("preview");
    expect(useWorkbench.getState().layout.auxiliaryBarVisible).toBe(true);
  });

  it("preview.toggleMarkdown flips the preview raw flag", () => {
    useWorkbench.getState().openPreview({ path: "/wt/a.md", name: "a.md" });
    renderHook(() => useShortcuts());
    act(() => fire("$mod+Shift+m"));
    expect(useWorkbench.getState().previewFile?.raw).toBe(true);
    act(() => fire("$mod+Shift+m"));
    expect(useWorkbench.getState().previewFile?.raw).toBe(false);
  });

  it("browser.toggleInspect dispatches maverick:browser:toggleInspect", () => {
    renderHook(() => useShortcuts());
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    act(() => fire("$mod+Shift+i"));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "maverick:browser:toggleInspect" })
    );
  });

  it("terminal.focusLeft dispatches maverick:terminal:focusDirection with detail left", () => {
    renderHook(() => useShortcuts());
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    act(() => fire("$mod+Alt+ArrowLeft"));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "maverick:terminal:focusDirection", detail: "left" })
    );
  });

  it("terminal.focusRight dispatches maverick:terminal:focusDirection with detail right", () => {
    renderHook(() => useShortcuts());
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    act(() => fire("$mod+Alt+ArrowRight"));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "maverick:terminal:focusDirection", detail: "right" })
    );
  });

  it("terminal.focusUp dispatches maverick:terminal:focusDirection with detail up", () => {
    renderHook(() => useShortcuts());
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    act(() => fire("$mod+Alt+ArrowUp"));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "maverick:terminal:focusDirection", detail: "up" })
    );
  });

  it("terminal.focusDown dispatches maverick:terminal:focusDirection with detail down", () => {
    renderHook(() => useShortcuts());
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    act(() => fire("$mod+Alt+ArrowDown"));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "maverick:terminal:focusDirection", detail: "down" })
    );
  });

  it("terminal.openBottomTerminal shows panel and dispatches maverick:panel:tab with terminal", () => {
    renderHook(() => useShortcuts());
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    act(() => fire("$mod+Shift+t"));
    expect(useWorkbench.getState().layout.panelVisible).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "maverick:panel:tab", detail: "terminal" })
    );
  });

  it("terminal.openBottomTerminal does not double-toggle when panel is already visible", () => {
    useWorkbench.setState({ ...useWorkbench.getState(), layout: { ...useWorkbench.getState().layout, panelVisible: true } });
    renderHook(() => useShortcuts());
    act(() => fire("$mod+Shift+t"));
    expect(useWorkbench.getState().layout.panelVisible).toBe(true);
  });

  it("layout/view/global handlers update store", () => {
    renderHook(() => useShortcuts());
    act(() => fire("$mod+b"));
    expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(false);
    act(() => fire("$mod+Shift+."));
    expect(useWorkbench.getState().layout.auxiliaryBarVisible).toBe(false);
    act(() => fire("$mod+j"));
    expect(useWorkbench.getState().layout.panelVisible).toBe(true);
    act(() => fire("$mod+Shift+g"));
    expect(useWorkbench.getState().layout.auxiliaryView).toBe("scm");
    expect(useWorkbench.getState().layout.auxiliaryBarVisible).toBe(true);
    act(() => fire("$mod+Shift+k"));
    expect(useWorkbench.getState().activeSystemTab).toBe("kanban");
    act(() => fire("$mod+Shift+b"));
    expect(useWorkbench.getState().activeSystemTab).toBe("browser");
    act(() => fire("$mod+Shift+a"));
    expect(useWorkbench.getState().activeSystemTab).toBe("automations");
    act(() => fire("$mod+Shift+p"));
    expect(useWorkbench.getState().commandPaletteOpen).toBe(true);
    act(() => fire("$mod+p"));
    expect(useWorkbench.getState().quickOpenOpen).toBe(true);
    act(() => fire("$mod+Shift+Space"));
    expect(useWorkbench.getState().presetLauncherOpen).toBe(true);
    act(() => fire("$mod+,"));
    expect(useWorkbench.getState().settingsOpen).toBe(true);
    act(() => fire("$mod+Shift+/"));
    expect(useWorkbench.getState().keybindingHelpOpen).toBe(true);
  });

  it("index jumps switch workspace; out-of-bounds is a no-op", () => {
    useWorkbench.getState().setWorkspaces([makeWorkspace({ id: "a" }), makeWorkspace({ id: "b" })]);
    renderHook(() => useShortcuts());
    act(() => fire("$mod+1"));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("a");
    act(() => fire("$mod+2"));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("b");
    act(() => fire("$mod+9"));
    // unchanged
    expect(useWorkbench.getState().activeWorkspaceId).toBe("b");
  });

  it("project-settings.open opens settings for active workspace project", () => {
    useWorkbench.getState().setWorkspaces([makeWorkspace({ id: "ws1", projectId: "p1" })]);
    useWorkbench.getState().setActiveWorkspace("ws1");
    renderHook(() => useShortcuts());
    act(() => fire("$mod+Shift+,"));
    const { projectSettings } = useWorkbench.getState();
    expect(projectSettings.open).toBe(true);
    expect(projectSettings.projectId).toBe("p1");
  });

  it("project-settings.open is a no-op when no active workspace", () => {
    renderHook(() => useShortcuts());
    act(() => fire("$mod+Shift+,"));
    expect(useWorkbench.getState().projectSettings.open).toBe(false);
  });

  it("ai.review is a no-op when there is no active workspace", () => {
    renderHook(() => useShortcuts());
    act(() => fire("$mod+Shift+r"));
    // No active workspace → handler returns before touching editor mode.
    expect(useWorkbench.getState().editorModes).toEqual({});
  });

  it("ai.review uses the project review preference and switches to agent mode", async () => {
    vi.mocked(invoke).mockReset().mockImplementation(((cmd: string) => {
      if (cmd === "diff_get") return Promise.resolve(makeDiff({ files: [makeDiffFile()] }));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    useProjectSettingsStore.setState({
      data: {
        name: "demo", rootPath: "/wt",
        workspaces: { branchFrom: "main", filesToCopy: [] },
        remote: "origin", previewUrl: "",
        scripts: { setup: "", run: "", archive: "" },
        preferences: { review: "Only flag security bugs." },
      },
      projectId: "p1", status: "loaded", dirty: {}, lastError: null,
    });
    useWorkbench.getState().setWorkspaces([makeWorkspace({ id: "w1", worktreePath: "/wt" })]);
    useWorkbench.getState().setActiveWorkspace("w1");
    renderHook(() => useShortcuts());
    act(() => fire("$mod+Shift+r"));
    await waitFor(() => expect(useWorkbench.getState().editorModes["w1"]).toBe("agent"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "pty_write",
        expect.objectContaining({ data: expect.stringContaining("Only flag security bugs.") })
      )
    );
    useProjectSettingsStore.setState({ data: null, projectId: null, status: "idle", dirty: {}, lastError: null });
  });
});
