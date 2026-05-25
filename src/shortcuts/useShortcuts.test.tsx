import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useShortcuts } from "./useShortcuts";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

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
      activityView: "projects",
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

  it("layout/view/global handlers update store", () => {
    renderHook(() => useShortcuts());
    act(() => fire("$mod+b"));
    expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(false);
    act(() => fire("$mod+Shift+."));
    expect(useWorkbench.getState().layout.auxiliaryBarVisible).toBe(false);
    act(() => fire("$mod+j"));
    expect(useWorkbench.getState().layout.panelVisible).toBe(true);
    act(() => fire("$mod+Shift+g"));
    expect(useWorkbench.getState().layout.activityView).toBe("git");
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
});
