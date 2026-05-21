import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  SettingsKey,
  SettingsValue,
  SettingsWriteResponse,
  SettingsSnapshot,
} from "@/lib/ipc";

type Status = "idle" | "saving" | "saved" | "error";

interface State {
  values: SettingsSnapshot;
  status: Status;
  lastError: string | null;
  set: (key: SettingsKey, value: SettingsValue) => void;
  hydrate: () => Promise<void>;
}

const DEBOUNCE_MS = 250;
const SAVED_TTL_MS = 800;

const pendingTimers = new Map<SettingsKey, ReturnType<typeof setTimeout>>();
let savedTimer: ReturnType<typeof setTimeout> | null = null;

export const useSettingsStore = create<State>((set, get) => ({
  values: {},
  status: "idle",
  lastError: null,

  set: (key, value) => {
    const previous = get().values[key];
    set((s) => ({ values: { ...s.values, [key]: value } }));

    const existing = pendingTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      pendingTimers.delete(key);
      set({ status: "saving", lastError: null });
      void Promise.resolve(
        invoke<SettingsWriteResponse>("settings_write", { key, value: get().values[key] }),
      )
        .then((res) => {
          if (res && res.ok === false) {
            set((s) => ({
              values: previous === undefined
                ? Object.fromEntries(Object.entries(s.values).filter(([k]) => k !== key))
                : { ...s.values, [key]: previous },
              status: "error",
              lastError: res.error,
            }));
            return;
          }
          set({ status: "saved", lastError: null });
          if (savedTimer) clearTimeout(savedTimer);
          savedTimer = setTimeout(() => set({ status: "idle" }), SAVED_TTL_MS);
        })
        .catch((err: unknown) => {
          set((s) => ({
            values: previous === undefined
              ? Object.fromEntries(Object.entries(s.values).filter(([k]) => k !== key))
              : { ...s.values, [key]: previous },
            status: "error",
            lastError: err instanceof Error ? err.message : String(err),
          }));
        });
    }, DEBOUNCE_MS);
    pendingTimers.set(key, timer);
  },

  hydrate: async () => {
    try {
      const snapshot = await invoke<SettingsSnapshot>("settings_read_all");
      set({ values: snapshot ?? {} });
    } catch {
      set({ values: {} });
    }
  },
}));

type Widen<V> = V extends string
  ? string
  : V extends number
    ? number
    : V extends boolean
      ? boolean
      : V;

export function useSettings<V extends SettingsValue>(
  key: SettingsKey,
  defaultValue: V,
): [Widen<V>, (value: Widen<V>) => void] {
  const value = useSettingsStore(
    (s) => (s.values[key] as Widen<V> | undefined) ?? (defaultValue as unknown as Widen<V>),
  );
  const set = useSettingsStore((s) => s.set);
  return [value, (v: Widen<V>) => set(key, v)];
}

/** Test-only — clears the store and any pending debounced timers. */
export function _resetSettingsStoreForTests(): void {
  pendingTimers.forEach((t) => clearTimeout(t));
  pendingTimers.clear();
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = null;
  useSettingsStore.setState({ values: {}, status: "idle", lastError: null });
}
