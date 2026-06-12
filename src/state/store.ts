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
  auxiliaryView: AuxiliaryView;
}

export type SystemTabId = "dashboard" | "browser" | "kanban" | "automations" | "mcps" | "skills" | "skill-editor";

export interface TerminalTab {
  id: string;
  cwd: string;
  title: string;
  ptyId: string;
}

export type FileTabKind = "file" | "diff";
export type FileTabMode = "view" | "edit" | "diff";

export interface FileTab {
  id: string;
  kind: FileTabKind;
  /** Absolute path of the file. */
  path: string;
  /** Worktree root — diff context and breadcrumb base. */
  worktreePath: string;
  /** "Open With…" override; undefined = registry default. */
  viewerId?: string;
  /** Italic preview tab — reused by the next single-click open. */
  preview: boolean;
  dirty: boolean;
  mode: FileTabMode;
  /** Diff-tab "viewed" checkbox state. */
  viewed: boolean;
}

export interface OpenFileTabInput {
  kind: FileTabKind;
  path: string;
  worktreePath: string;
  preview: boolean;
  mode?: FileTabMode;
  viewerId?: string;
}

export const fileTabId = (kind: FileTabKind, path: string): string => `${kind}:${path}`;

interface WorkbenchState {
  // Data
  projects: Project[];
  workspaces: Workspace[];
  backends: Backend[];
  skills: Skill[];

  // System tabs (browser, kanban etc) opened as editor tabs alongside workspaces
  systemTabs: SystemTabId[];
  activeSystemTab: SystemTabId | null;

  // Terminal tabs (standalone PTY tabs)
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;

  // File tabs (real editor tabs with VSCode preview-tab semantics)
  fileTabs: FileTab[];
  activeFileTabId: string | null;

  // Per-workspace state
  activeWorkspaceId: string | null;
  // Most-recently-used first. Drives LRU render suspension of editor groups.
  workspaceAccessOrder: string[];
  editorModes: Record<string, EditorMode>;
  splitTrees: Record<string, SplitNode>;

  // Layout
  layout: PanelLayout;

  // Workspaces whose setup script should auto-run in the Panel's Setup tab the
  // next time they are active (set right after workspace.create returns).
  pendingSetupIds: string[];

  // Overlays
  commandPaletteOpen: boolean;
  quickOpenOpen: boolean;
  presetLauncherOpen: boolean;
  keybindingHelpOpen: boolean;
  settingsOpen: boolean;
  projectSettings: {
    open: boolean;
    projectId: string | null;
    initialSection?: "identity" | "workspaces" | "preview" | "scripts" | "preferences";
    focusField?: string;
  };

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
  queueSetup: (workspaceId: string) => void;
  clearPendingSetup: (workspaceId: string) => void;

  // Layout actions
  showPrimarySideBar: () => void;
  openSourceControl: () => void;
  setAuxiliaryView: (view: AuxiliaryView) => void;
  setActivitybarCollapsed: (collapsed: boolean) => void;
  toggleActivitybarCollapsed: () => void;
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
  openProjectSettings: (args: {
    projectId: string;
    initialSection?: "identity" | "workspaces" | "preview" | "scripts" | "preferences";
    focusField?: string;
  }) => void;
  closeProjectSettings: () => void;

  // System tabs
  openSystemTab: (id: SystemTabId) => void;
  closeSystemTab: (id: SystemTabId) => void;
  setActiveSystemTab: (id: SystemTabId | null) => void;

  // Terminal tabs
  addTerminalTab: (tab: TerminalTab) => void;
  removeTerminalTab: (id: string) => void;
  setActiveTerminalTab: (id: string | null) => void;
  /** Bind a freshly-spawned PTY to an optimistically-added terminal tab. */
  setTerminalTabPty: (id: string, ptyId: string) => void;

  // File tab mutators
  openFileTab: (input: OpenFileTabInput) => void;
  setActiveFileTab: (id: string | null) => void;
  /** Returns false when blocked by a dirty tab (caller shows confirm UI). */
  closeFileTab: (id: string, opts?: { force?: boolean }) => boolean;
  pinFileTab: (id: string) => void;
  setFileTabDirty: (id: string, dirty: boolean) => void;
  setFileTabMode: (id: string, mode: FileTabMode) => void;
  setFileTabViewer: (id: string, viewerId: string) => void;
  setFileTabViewed: (id: string, viewed: boolean) => void;
}

export const useWorkbench = create<WorkbenchState>()(
  subscribeWithSelector((set, get) => ({
    projects: [],
    workspaces: [],
    backends: [],
    skills: [],
    systemTabs: [],
    activeSystemTab: null,
    terminalTabs: [],
    activeTerminalTabId: null,
    fileTabs: [],
    activeFileTabId: null,
    activeWorkspaceId: null,
    workspaceAccessOrder: [],
    editorModes: {},
    splitTrees: {},

    layout: {
      activitybarCollapsed: false,
      primarySideBarVisible: true,
      primarySideBarWidth: 200,
      auxiliaryBarVisible: true,
      auxiliaryBarWidth: 280,
      panelVisible: true,
      panelHeight: 220,
      auxiliaryView: "files",
    },

    pendingSetupIds: [],

    commandPaletteOpen: false,
    quickOpenOpen: false,
    presetLauncherOpen: false,
    keybindingHelpOpen: false,
    settingsOpen: false,
    projectSettings: { open: false, projectId: null },

    setProjects: (projects) => set({ projects }),
    addProject: (project) => set((s) => ({ projects: [...s.projects, project] })),
    setWorkspaces: (workspaces) =>
      set((s) => ({
        workspaces,
        workspaceAccessOrder: s.workspaceAccessOrder.filter((wid) =>
          workspaces.some((w) => w.id === wid)
        ),
      })),
    addWorkspace: (workspace) =>
      set((s) => ({
        workspaces: [...s.workspaces, workspace],
        workspaceAccessOrder: [
          workspace.id,
          ...s.workspaceAccessOrder.filter((wid) => wid !== workspace.id),
        ],
      })),
    removeWorkspace: (id) =>
      set((s) => ({
        workspaces: s.workspaces.filter((w) => w.id !== id),
        activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
        workspaceAccessOrder: s.workspaceAccessOrder.filter((wid) => wid !== id),
      })),
    updateWorkspace: (id, patch) =>
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      })),
    setActiveWorkspace: (id) =>
      set((s) => ({
        activeWorkspaceId: id,
        // Selecting a workspace switches the editor away from any system tab or
        // standalone terminal tab, mirroring how opening one clears the active
        // workspace.
        activeSystemTab: id ? null : s.activeSystemTab,
        activeTerminalTabId: id ? null : s.activeTerminalTabId,
        activeFileTabId: id ? null : s.activeFileTabId,
        workspaceAccessOrder: id
          ? [id, ...s.workspaceAccessOrder.filter((wid) => wid !== id)]
          : s.workspaceAccessOrder,
      })),
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
    queueSetup: (workspaceId) =>
      set((s) => ({
        pendingSetupIds: s.pendingSetupIds.includes(workspaceId)
          ? s.pendingSetupIds
          : [...s.pendingSetupIds, workspaceId],
        // Setup output streams in the bottom Panel; make sure it is on screen.
        layout: { ...s.layout, auxiliaryBarVisible: true, panelVisible: true },
      })),
    clearPendingSetup: (workspaceId) =>
      set((s) => ({
        pendingSetupIds: s.pendingSetupIds.filter((id) => id !== workspaceId),
      })),

    showPrimarySideBar: () =>
      set((s) => ({
        layout: { ...s.layout, primarySideBarVisible: true },
      })),
    openSourceControl: () =>
      set((s) => ({
        layout: { ...s.layout, auxiliaryView: "scm", auxiliaryBarVisible: true },
      })),
    setAuxiliaryView: (view) =>
      set((s) => ({ layout: { ...s.layout, auxiliaryView: view } })),
    setActivitybarCollapsed: (collapsed) =>
      set((s) => ({ layout: { ...s.layout, activitybarCollapsed: collapsed } })),
    toggleActivitybarCollapsed: () =>
      set((s) => ({ layout: { ...s.layout, activitybarCollapsed: !s.layout.activitybarCollapsed } })),
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
    openProjectSettings: ({ projectId, initialSection, focusField }) =>
      set({ projectSettings: { open: true, projectId, initialSection, focusField } }),
    closeProjectSettings: () =>
      set((s) => ({ projectSettings: { ...s.projectSettings, open: false, projectId: null } })),

    openSystemTab: (id) =>
      set((s) => ({
        systemTabs: s.systemTabs.includes(id) ? s.systemTabs : [...s.systemTabs, id],
        activeSystemTab: id,
        activeWorkspaceId: null,
        activeTerminalTabId: null,
        activeFileTabId: null,
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
        activeTerminalTabId: id ? null : s.activeTerminalTabId,
        activeFileTabId: id ? null : s.activeFileTabId,
      })),

    addTerminalTab: (tab) =>
      set((s) => ({
        terminalTabs: s.terminalTabs.some((t) => t.id === tab.id)
          ? s.terminalTabs
          : [...s.terminalTabs, tab],
      })),
    setTerminalTabPty: (id, ptyId) =>
      set((s) => ({
        terminalTabs: s.terminalTabs.map((t) => (t.id === id ? { ...t, ptyId } : t)),
      })),
    removeTerminalTab: (id) =>
      set((s) => ({
        terminalTabs: s.terminalTabs.filter((t) => t.id !== id),
        activeTerminalTabId: s.activeTerminalTabId === id ? null : s.activeTerminalTabId,
      })),
    setActiveTerminalTab: (id) =>
      set(() => ({
        activeTerminalTabId: id,
        activeWorkspaceId: null,
        activeSystemTab: null,
        activeFileTabId: null,
      })),

    openFileTab: (input) =>
      set((s) => {
        const id = fileTabId(input.kind, input.path);
        const defaultMode: FileTabMode = input.mode ?? (input.kind === "diff" ? "diff" : "edit");
        const existing = s.fileTabs.find((t) => t.id === id);
        if (existing) {
          return {
            fileTabs: s.fileTabs.map((t) =>
              t.id === id ? { ...t, preview: t.preview && input.preview } : t
            ),
            activeFileTabId: id,
            activeWorkspaceId: null,
            activeSystemTab: null,
            activeTerminalTabId: null,
          };
        }
        const tab: FileTab = {
          id,
          kind: input.kind,
          path: input.path,
          worktreePath: input.worktreePath,
          viewerId: input.viewerId,
          preview: input.preview,
          dirty: false,
          mode: defaultMode,
          viewed: false,
        };
        // VSCode preview semantics: at most one preview tab; a new preview
        // open replaces it in place instead of appending.
        const previewIdx = input.preview ? s.fileTabs.findIndex((t) => t.preview) : -1;
        const fileTabs =
          previewIdx >= 0
            ? s.fileTabs.map((t, i) => (i === previewIdx ? tab : t))
            : [...s.fileTabs, tab];
        return {
          fileTabs,
          activeFileTabId: id,
          activeWorkspaceId: null,
          activeSystemTab: null,
          activeTerminalTabId: null,
        };
      }),

    setActiveFileTab: (id) =>
      set((s) => ({
        activeFileTabId: id,
        activeWorkspaceId: id ? null : s.activeWorkspaceId,
        activeSystemTab: id ? null : s.activeSystemTab,
        activeTerminalTabId: id ? null : s.activeTerminalTabId,
      })),

    closeFileTab: (id, opts) => {
      const tab = get().fileTabs.find((t) => t.id === id);
      if (!tab) return true;
      if (tab.dirty && !opts?.force) return false;
      set((s) => ({
        fileTabs: s.fileTabs.filter((t) => t.id !== id),
        activeFileTabId: s.activeFileTabId === id ? null : s.activeFileTabId,
      }));
      return true;
    },

    pinFileTab: (id) =>
      set((s) => ({
        fileTabs: s.fileTabs.map((t) => (t.id === id ? { ...t, preview: false } : t)),
      })),

    setFileTabDirty: (id, dirty) =>
      set((s) => ({
        fileTabs: s.fileTabs.map((t) =>
          t.id === id ? { ...t, dirty, preview: dirty ? false : t.preview } : t
        ),
      })),

    setFileTabMode: (id, mode) =>
      set((s) => ({
        fileTabs: s.fileTabs.map((t) => (t.id === id ? { ...t, mode } : t)),
      })),

    setFileTabViewer: (id, viewerId) =>
      set((s) => ({
        fileTabs: s.fileTabs.map((t) => (t.id === id ? { ...t, viewerId } : t)),
      })),

    setFileTabViewed: (id, viewed) =>
      set((s) => ({
        fileTabs: s.fileTabs.map((t) => (t.id === id ? { ...t, viewed } : t)),
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

/**
 * The set of workspace ids whose editors stay rendered (keep-alive). When more
 * than `lruLimit` workspaces are open, the least-recently-used ones fall out of
 * this set and have their DOM destroyed — their sidecar PTYs are unaffected.
 * The active workspace is always live.
 */
export function computeLiveWorkspaceIds(
  workspaces: Workspace[],
  accessOrder: string[],
  activeWorkspaceId: string | null,
  lruLimit: number
): Set<string> {
  const existing = new Set(workspaces.map((w) => w.id));
  if (lruLimit <= 0 || workspaces.length <= lruLimit) return existing;

  const ranked = accessOrder.filter((id) => existing.has(id));
  // Any open workspace missing from the access order (e.g. restored from disk)
  // is appended so it can still be reached before suspension kicks in.
  for (const w of workspaces) {
    if (!ranked.includes(w.id)) ranked.push(w.id);
  }
  const live = new Set(ranked.slice(0, lruLimit));
  if (activeWorkspaceId) live.add(activeWorkspaceId);
  return live;
}
