// Central Zustand store — single source of truth for the Workbench
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { disposeWorkspaceRunners } from "@/lib/script-runner";
import { killWorkspaceLeaves } from "@/components/editor/terminal/leaf-registry";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";
import type {
  Project,
  Workspace,
  Backend,
  Skill,
  SplitNode,
  LaunchSpec,
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

export type SystemTabId = "dashboard" | "usage" | "browser" | "kanban" | "automations" | "mcps" | "skills" | "skill-editor" | "git";

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
  // The skill currently loaded into the editor (null = creating a new one).
  editingSkill: Skill | null;

  // System tabs (browser, kanban etc) opened as editor tabs alongside workspaces
  systemTabs: SystemTabId[];
  activeSystemTab: SystemTabId | null;

  // Terminal tabs (standalone PTY tabs)
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;

  // File tabs (real editor tabs with VSCode preview-tab semantics)
  fileTabs: FileTab[];
  activeFileTabId: string | null;
  // MRU-first. Drives LRU render suspension of file tab panes (mirrors workspaceAccessOrder).
  fileTabAccessOrder: string[];

  // Per-workspace state
  activeWorkspaceId: string | null;
  // Most-recently-used first. Drives LRU render suspension of editor groups.
  workspaceAccessOrder: string[];
  splitTrees: Record<string, SplitNode>;
  // Single-shot CLI launch directives, keyed by workspace id. Set when a
  // workspace is opened for an agent (kanban / preset); consumed once by the
  // primary terminal leaf when its shell PTY is ready, then deleted.
  launchSpecs: Record<string, LaunchSpec>;

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
  // Workspaces created via "let AI name it later" — renamed from their diff after
  // the first commit. workspaceId list; cleared once renamed (or on destroy).
  pendingAiRename: string[];
  markPendingAiRename: (id: string) => void;
  clearPendingAiRename: (id: string) => void;
  setActiveWorkspace: (id: string | null) => void;
  setSplitTree: (workspaceId: string, tree: SplitNode) => void;
  /** Stage a one-shot CLI launch for a workspace's primary terminal leaf. */
  setLaunchSpec: (workspaceId: string, spec: LaunchSpec) => void;
  /** Return and remove a workspace's launch spec (single-shot); null if none. */
  consumeLaunchSpec: (workspaceId: string) => LaunchSpec | null;
  setBackends: (backends: Backend[]) => void;
  setSkills: (skills: Skill[]) => void;
  setEditingSkill: (skill: Skill | null) => void;
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
    editingSkill: null,
    systemTabs: [],
    activeSystemTab: null,
    terminalTabs: [],
    activeTerminalTabId: null,
    fileTabs: [],
    activeFileTabId: null,
    fileTabAccessOrder: [],
    activeWorkspaceId: null,
    workspaceAccessOrder: [],
    splitTrees: {},
    launchSpecs: {},
    pendingAiRename: [],

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
    removeWorkspace: (id) => {
      // Canonical teardown for BOTH close paths (tab X / ⌘W go through here, not
      // just the Archive action): kill the Run/Setup processes AND every per-leaf
      // shell PTY, so closing a tab can't orphan a dev server or a login shell.
      disposeWorkspaceRunners(id);
      killWorkspaceLeaves(id);
      useAgentStatusStore.getState().clearStatus(id);
      set((s) => {
        const { [id]: _spec, ...launchSpecs } = s.launchSpecs;
        const { [id]: _tree, ...splitTrees } = s.splitTrees;
        return {
          workspaces: s.workspaces.filter((w) => w.id !== id),
          activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
          workspaceAccessOrder: s.workspaceAccessOrder.filter((wid) => wid !== id),
          launchSpecs,
          splitTrees,
          pendingAiRename: s.pendingAiRename.filter((wid) => wid !== id),
        };
      });
    },
    updateWorkspace: (id, patch) =>
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      })),
    markPendingAiRename: (id) =>
      set((s) => ({
        pendingAiRename: s.pendingAiRename.includes(id)
          ? s.pendingAiRename
          : [...s.pendingAiRename, id],
      })),
    clearPendingAiRename: (id) =>
      set((s) => ({ pendingAiRename: s.pendingAiRename.filter((w) => w !== id) })),
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
    setSplitTree: (workspaceId, tree) =>
      set((s) => ({ splitTrees: { ...s.splitTrees, [workspaceId]: tree } })),
    setLaunchSpec: (workspaceId, spec) =>
      set((s) => ({ launchSpecs: { ...s.launchSpecs, [workspaceId]: spec } })),
    consumeLaunchSpec: (workspaceId) => {
      const spec = get().launchSpecs[workspaceId] ?? null;
      if (spec) {
        set((s) => {
          const { [workspaceId]: _removed, ...rest } = s.launchSpecs;
          return { launchSpecs: rest };
        });
      }
      return spec;
    },
    setBackends: (backends) => set({ backends }),
    setSkills: (skills) => set({ skills }),
    setEditingSkill: (editingSkill) => set({ editingSkill }),
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
            fileTabAccessOrder: [id, ...s.fileTabAccessOrder.filter((fid) => fid !== id)],
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
          fileTabAccessOrder: [id, ...s.fileTabAccessOrder.filter((fid) => fid !== id)],
        };
      }),

    setActiveFileTab: (id) =>
      set((s) => ({
        activeFileTabId: id,
        activeWorkspaceId: id ? null : s.activeWorkspaceId,
        activeSystemTab: id ? null : s.activeSystemTab,
        activeTerminalTabId: id ? null : s.activeTerminalTabId,
        fileTabAccessOrder: id
          ? [id, ...s.fileTabAccessOrder.filter((fid) => fid !== id)]
          : s.fileTabAccessOrder,
      })),

    closeFileTab: (id, opts) => {
      const tab = get().fileTabs.find((t) => t.id === id);
      if (!tab) return true;
      if (tab.dirty && !opts?.force) return false;
      set((s) => ({
        fileTabs: s.fileTabs.filter((t) => t.id !== id),
        activeFileTabId: s.activeFileTabId === id ? null : s.activeFileTabId,
        fileTabAccessOrder: s.fileTabAccessOrder.filter((fid) => fid !== id),
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

/**
 * The workspace whose worktree the AuxiliaryBar (Files / Changes / Source
 * Control) operates on. Opening a file or diff tab clears `activeWorkspaceId`
 * (the editor shows the file, not the workspace), so this falls back to the
 * active file tab's worktree — keeping the file tree, change list, and commit
 * UI populated while you inspect a diff instead of blanking to the empty state.
 */
export const selectContextWorkspace = (s: WorkbenchState): Workspace | undefined => {
  const active = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  if (active) return active;
  if (s.activeFileTabId) {
    const tab = s.fileTabs.find((t) => t.id === s.activeFileTabId);
    if (tab) return s.workspaces.find((w) => w.worktreePath === tab.worktreePath);
  }
  return undefined;
};

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

/**
 * The set of file tab ids whose panes stay rendered (keep-alive). When more
 * than `lruLimit` tabs are open, the least-recently-used CLEAN tabs fall out
 * of this set and have their DOM destroyed — they remount from disk on re-focus.
 * The active tab and ALL dirty tabs are always live: suspending a dirty tab
 * would call disposeModelForPath on unmount and destroy unsaved edits.
 */
export function computeLiveFileTabIds(
  fileTabs: FileTab[],
  accessOrder: string[],
  activeFileTabId: string | null,
  lruLimit: number
): Set<string> {
  const existing = new Set(fileTabs.map((t) => t.id));
  if (lruLimit <= 0 || fileTabs.length <= lruLimit) return existing;

  const ranked = accessOrder.filter((id) => existing.has(id));
  // Tabs missing from the access order (e.g. restored from disk) are appended.
  for (const t of fileTabs) {
    if (!ranked.includes(t.id)) ranked.push(t.id);
  }
  const live = new Set(ranked.slice(0, lruLimit));
  // Active tab is always live.
  if (activeFileTabId) live.add(activeFileTabId);
  // Dirty tabs are always live — suspending them would destroy unsaved edits.
  for (const t of fileTabs) {
    if (t.dirty) live.add(t.id);
  }
  return live;
}
