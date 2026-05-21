// Central Zustand store — single source of truth for the Workbench
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  Project,
  Workspace,
  Backend,
  Skill,
  SplitNode,
  EditorMode,
  ActivityView,
  AuxiliaryView,
} from "@/lib/ipc";

interface PanelLayout {
  activitybarCollapsed: boolean;
  primarySideBarVisible: boolean;
  primarySideBarWidth: number;
  auxiliaryBarVisible: boolean;
  auxiliaryBarWidth: number;
  panelVisible: boolean;
  panelHeight: number;
  activityView: ActivityView;
  auxiliaryView: AuxiliaryView;
}

export type SystemTabId = "dashboard" | "browser" | "kanban" | "automations" | "mcps";

interface WorkbenchState {
  // Data
  projects: Project[];
  workspaces: Workspace[];
  backends: Backend[];
  skills: Skill[];

  // System tabs (browser, kanban etc) opened as editor tabs alongside workspaces
  systemTabs: SystemTabId[];
  activeSystemTab: SystemTabId | null;

  // Per-workspace state
  activeWorkspaceId: string | null;
  editorModes: Record<string, EditorMode>;
  splitTrees: Record<string, SplitNode>;

  // Layout
  layout: PanelLayout;

  // Overlays
  commandPaletteOpen: boolean;
  quickOpenOpen: boolean;
  presetLauncherOpen: boolean;
  keybindingHelpOpen: boolean;
  settingsOpen: boolean;

  // Mutators
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  addWorkspace: (workspace: Workspace) => void;
  removeWorkspace: (id: string) => void;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;
  setActiveWorkspace: (id: string | null) => void;
  setEditorMode: (workspaceId: string, mode: EditorMode) => void;
  toggleEditorMode: (workspaceId: string) => void;
  setSplitTree: (workspaceId: string, tree: SplitNode) => void;
  setBackends: (backends: Backend[]) => void;
  setSkills: (skills: Skill[]) => void;

  // Layout actions
  setActivityView: (view: ActivityView) => void;
  setAuxiliaryView: (view: AuxiliaryView) => void;
  togglePrimarySideBar: () => void;
  toggleAuxiliaryBar: () => void;
  togglePanel: () => void;
  setPrimarySideBarWidth: (w: number) => void;
  setAuxiliaryBarWidth: (w: number) => void;
  setPanelHeight: (h: number) => void;

  // Overlays
  setCommandPaletteOpen: (open: boolean) => void;
  setQuickOpenOpen: (open: boolean) => void;
  setPresetLauncherOpen: (open: boolean) => void;
  setKeybindingHelpOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;

  // System tabs
  openSystemTab: (id: SystemTabId) => void;
  closeSystemTab: (id: SystemTabId) => void;
  setActiveSystemTab: (id: SystemTabId | null) => void;
}

export const useWorkbench = create<WorkbenchState>()(
  subscribeWithSelector((set) => ({
    projects: [],
    workspaces: [],
    backends: [],
    skills: [],
    systemTabs: [],
    activeSystemTab: null,
    activeWorkspaceId: null,
    editorModes: {},
    splitTrees: {},

    layout: {
      activitybarCollapsed: false,
      primarySideBarVisible: true,
      primarySideBarWidth: 240,
      auxiliaryBarVisible: true,
      auxiliaryBarWidth: 280,
      panelVisible: true,
      panelHeight: 220,
      activityView: "projects",
      auxiliaryView: "files",
    },

    commandPaletteOpen: false,
    quickOpenOpen: false,
    presetLauncherOpen: false,
    keybindingHelpOpen: false,
    settingsOpen: false,

    setProjects: (projects) => set({ projects }),
    addProject: (project) => set((s) => ({ projects: [...s.projects, project] })),
    setWorkspaces: (workspaces) => set({ workspaces }),
    addWorkspace: (workspace) => set((s) => ({ workspaces: [...s.workspaces, workspace] })),
    removeWorkspace: (id) =>
      set((s) => ({
        workspaces: s.workspaces.filter((w) => w.id !== id),
        activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
      })),
    updateWorkspace: (id, patch) =>
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      })),
    setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
    setEditorMode: (workspaceId, mode) =>
      set((s) => ({ editorModes: { ...s.editorModes, [workspaceId]: mode } })),
    toggleEditorMode: (workspaceId) =>
      set((s) => ({
        editorModes: {
          ...s.editorModes,
          [workspaceId]: s.editorModes[workspaceId] === "terminal" ? "agent" : "terminal",
        },
      })),
    setSplitTree: (workspaceId, tree) =>
      set((s) => ({ splitTrees: { ...s.splitTrees, [workspaceId]: tree } })),
    setBackends: (backends) => set({ backends }),
    setSkills: (skills) => set({ skills }),

    setActivityView: (view) =>
      set((s) => ({
        layout: {
          ...s.layout,
          activityView: view,
          primarySideBarVisible: true,
        },
      })),
    setAuxiliaryView: (view) =>
      set((s) => ({ layout: { ...s.layout, auxiliaryView: view } })),
    togglePrimarySideBar: () =>
      set((s) => ({
        layout: { ...s.layout, primarySideBarVisible: !s.layout.primarySideBarVisible },
      })),
    toggleAuxiliaryBar: () =>
      set((s) => ({
        layout: { ...s.layout, auxiliaryBarVisible: !s.layout.auxiliaryBarVisible },
      })),
    togglePanel: () =>
      set((s) => ({ layout: { ...s.layout, panelVisible: !s.layout.panelVisible } })),
    setPrimarySideBarWidth: (w) =>
      set((s) => ({ layout: { ...s.layout, primarySideBarWidth: w } })),
    setAuxiliaryBarWidth: (w) =>
      set((s) => ({ layout: { ...s.layout, auxiliaryBarWidth: w } })),
    setPanelHeight: (h) => set((s) => ({ layout: { ...s.layout, panelHeight: h } })),

    setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    setQuickOpenOpen: (open) => set({ quickOpenOpen: open }),
    setPresetLauncherOpen: (open) => set({ presetLauncherOpen: open }),
    setKeybindingHelpOpen: (open) => set({ keybindingHelpOpen: open }),
    setSettingsOpen: (open) => set({ settingsOpen: open }),

    openSystemTab: (id) =>
      set((s) => ({
        systemTabs: s.systemTabs.includes(id) ? s.systemTabs : [...s.systemTabs, id],
        activeSystemTab: id,
        activeWorkspaceId: null,
      })),
    closeSystemTab: (id) =>
      set((s) => ({
        systemTabs: s.systemTabs.filter((t) => t !== id),
        activeSystemTab: s.activeSystemTab === id ? null : s.activeSystemTab,
      })),
    setActiveSystemTab: (id) =>
      set((s) => ({
        activeSystemTab: id,
        activeWorkspaceId: id ? null : s.activeWorkspaceId,
      })),
  }))
);

// Selectors
export const selectActiveWorkspace = (s: WorkbenchState): Workspace | undefined =>
  s.workspaces.find((w) => w.id === s.activeWorkspaceId);

export const selectEditorMode =
  (workspaceId: string) =>
  (s: WorkbenchState): EditorMode =>
    s.editorModes[workspaceId] ?? "agent";

export const selectWorkspacesForProject =
  (projectId: string) =>
  (s: WorkbenchState): Workspace[] =>
    s.workspaces.filter((w) => w.projectId === projectId);
