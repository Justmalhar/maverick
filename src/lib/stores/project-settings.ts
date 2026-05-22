import { create } from "zustand";
import type { ProjectSettings } from "@/lib/ipc";
import { projectSettingsGet, projectSettingsUpdate } from "@/lib/tauri";

type Status = "idle" | "loading" | "loaded" | "saving" | "error";

interface State {
  projectId: string | null;
  status: Status;
  data: ProjectSettings | null;
  dirty: Partial<ProjectSettings>;
  lastError: string | null;
  load: (projectId: string) => Promise<void>;
  patch: (partial: Partial<ProjectSettings>) => void;
  flush: () => Promise<void>;
  reset: () => void;
}

export const useProjectSettingsStore = create<State>((set, get) => ({
  projectId: null,
  status: "idle",
  data: null,
  dirty: {},
  lastError: null,

  load: async (projectId) => {
    set({ status: "loading", projectId, lastError: null, dirty: {} });
    try {
      const data = await projectSettingsGet(projectId);
      set({ status: "loaded", data });
    } catch (e) {
      set({ status: "error", lastError: e instanceof Error ? e.message : String(e) });
    }
  },

  patch: (partial) => set((s) => ({ dirty: { ...s.dirty, ...partial } })),

  flush: async () => {
    const { projectId, dirty } = get();
    if (!projectId || Object.keys(dirty).length === 0) return;
    set({ status: "saving", lastError: null });
    try {
      const saved = await projectSettingsUpdate(projectId, dirty);
      set({ status: "loaded", data: saved, dirty: {} });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ status: "error", lastError: msg });
    }
  },

  reset: () => set({ projectId: null, status: "idle", data: null, dirty: {}, lastError: null }),
}));
