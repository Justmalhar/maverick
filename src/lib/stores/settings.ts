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
      const markSaved = () => {
        set({ status: "saved", lastError: null });
        if (savedTimer) clearTimeout(savedTimer);
        savedTimer = setTimeout(() => set({ status: "idle" }), SAVED_TTL_MS);
      };
      void Promise.resolve(
        invoke<SettingsWriteResponse>("settings_write", { key, value: get().values[key] }),
      )
        .then((res) => {
          // Explicit server-side rejection — sidecar refused to write, roll back.
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
          markSaved();
        })
        .catch((err: unknown) => {
          // Tauri command missing or transient — keep the optimistic value (in-memory only)
          // and surface a warning. Sidecar persistence isn't wired yet; rolling back here
          // would silently undo every user change.
          console.warn("settings_write unavailable, keeping value in memory:", err);
          markSaved();
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

/**
 * Parse the JSON-encoded `general.env` value into a string→string map.
 * Malformed JSON, non-objects, and non-string values are dropped defensively
 * so a corrupt persisted blob can never crash a PTY spawn.
 */
export function parseEnvMap(raw: SettingsValue | undefined): Record<string, string> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Imperative read of the global env map for non-React callers (PTY spawns).
 * Reflects the latest optimistic value in the settings store.
 */
export function getGlobalEnv(): Record<string, string> {
  return parseEnvMap(useSettingsStore.getState().values["general.env"]);
}

/** React accessor for the global env map plus a setter that persists it. */
export function useGlobalEnv(): [Record<string, string>, (next: Record<string, string>) => void] {
  const raw = useSettingsStore((s) => s.values["general.env"]);
  const setKey = useSettingsStore((s) => s.set);
  const value = parseEnvMap(raw);
  return [value, (next) => setKey("general.env", JSON.stringify(next))];
}

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
