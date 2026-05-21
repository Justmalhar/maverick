# Settings UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Settings panel into a Warp-grade modal — categorised nav with search, stacked-card setting rows with helper text, proper Switch/Select primitives, glassmorphism shell, optimistic-save store, and a footer with raw-config + sync status.

**Architecture:** A shadcn-Dialog modal split into `SettingsNavRail` (search + grouped nav) and a `ContentArea` (header + scrolling body + footer). Each settings field is rendered by shared `SettingsRow`/`SettingsGroup` primitives that delegate read/write to a typed Zustand store (`useSettings`). Persistence is optimistic, debounced 250 ms, and round-trips a `settings_write` Tauri command (stubbed for now).

**Tech Stack:** React 19, TypeScript, Tailwind v4 + `@theme` tokens, shadcn (Radix), Framer Motion, Zustand 5, Vitest + Testing Library, lucide-react, cmdk (for nav filtering).

**Repo notes for the executor:**
- All commits use plain `git commit -m "…"`. The repo isn't currently a git repo; run `git init && git add -A && git commit -m "chore: snapshot before settings redesign"` at the very start if `git status` errors. Otherwise commit normally.
- Always use `bun` not `npm` (`bun run test`, `bunx shadcn add …`).
- Files under `src/components/ui/**` and `src/lib/ipc.ts` are excluded from coverage thresholds (see `vitest.config.ts`) — you don't need tests for re-themed shadcn primitives or pure type files.
- Existing section tests pass `data-testid` selectors. Keep those test-ids on the new primitives so existing tests keep working while you replace the section.

**Spec reference:** `docs/superpowers/specs/2026-05-21-settings-ui-redesign-design.md`

---

## Task 0: Repo prep & coverage baseline

**Files:** none modified.

- [ ] **Step 1: Confirm starting state is green**

Run: `bun run test:coverage`
Expected: PASS. Note the line/branch percentages — they must not regress.

- [ ] **Step 2: If repo is not initialised, init it**

```bash
git status 2>/dev/null || (git init && git add -A && git commit -m "chore: snapshot before settings redesign")
```

- [ ] **Step 3: Create working branch**

```bash
git checkout -b cc-ui/settings-redesign
```

---

## Task 1: Add design tokens

**Files:**
- Modify: `src/styles/tokens.css` — append 3 new variables.
- Modify: `src/styles/globals.css` — expose the new tokens in the Tailwind `@theme` block.

- [ ] **Step 1: Add the three tokens**

Append to the bottom of `:root { … }` in `src/styles/tokens.css`:

```css
  /* Settings modal */
  --shadow-modal: 0 24px 64px -12px rgb(0 0 0 / 0.5);
  --settings-nav-width: 220px;
  --settings-modal-max-w: 960px;
```

- [ ] **Step 2: Map them into Tailwind v4**

Append inside the `@theme inline { … }` block of `src/styles/globals.css`:

```css
  --shadow-modal: var(--shadow-modal);
  --width-settings-nav: var(--settings-nav-width);
  --max-w-settings-modal: var(--settings-modal-max-w);
```

(The `--width-*` and `--max-w-*` namespaces produce `w-settings-nav` and `max-w-settings-modal` utilities.)

- [ ] **Step 3: Verify build still typechecks**

Run: `bun run typecheck`
Expected: PASS, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/styles/tokens.css src/styles/globals.css
git commit -m "feat(tokens): add settings modal shadow, nav width, modal max-width"
```

---

## Task 2: Install shadcn Switch + Select primitives

**Files:**
- Create: `src/components/ui/switch.tsx` (via `bunx shadcn add`)
- Create: `src/components/ui/select.tsx` (via `bunx shadcn add`)

- [ ] **Step 1: Add the primitives**

```bash
bunx shadcn@latest add switch select
```

Expected output mentions creating both files. Accept any prompts with the default option.

- [ ] **Step 2: Re-theme via Tailwind classes inside the primitive only**

Open `src/components/ui/switch.tsx`. Locate the `cn(...)` call for `SwitchPrimitives.Root` and replace the existing utility string with:

```ts
cn(
  "peer inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-accent data-[state=checked]:to-accent/80 data-[state=unchecked]:bg-muted",
  className,
)
```

And for `SwitchPrimitives.Thumb`:

```ts
cn(
  "pointer-events-none block h-3.5 w-3.5 rounded-full bg-foreground shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0.5",
)
```

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/switch.tsx src/components/ui/select.tsx
git commit -m "feat(ui): add shadcn switch and select primitives"
```

---

## Task 3: Add IPC types for settings

**Files:**
- Modify: `src/lib/ipc.ts` — append type definitions.
- Modify: `sidecar/types.ts` — mirror the same types (if file exists; otherwise create stub).

- [ ] **Step 1: Append types to `src/lib/ipc.ts`**

Add at the end of the file:

```ts
// ---------- Settings ----------

export type SettingsKey =
  | "general.defaultBackend"
  | "general.defaultBranch"
  | "general.namingScheme"
  | "general.restoreSession"
  | "appearance.theme"
  | "appearance.uiFontSize"
  | "appearance.terminalFontSize"
  | "appearance.ligatures"
  | "appearance.animations"
  | "notifications.agent.waiting"
  | "notifications.agent.complete"
  | "notifications.agent.error"
  | "notifications.build.result"
  | "notifications.quota.warning"
  | "git.remote"
  | "git.template"
  | "git.autoFetchMinutes"
  | "git.gpgSign"
  | "advanced.largeTextThreshold"
  | "advanced.lruLimit"
  | "advanced.caffeinate"
  | "advanced.telemetry"
  | "account.licenseKey"
  | "account.updateChannel";

export type SettingsValue = string | number | boolean;

export interface SettingsWriteRequest {
  key: SettingsKey;
  value: SettingsValue;
}

export type SettingsWriteResponse =
  | { ok: true }
  | { ok: false; error: string };

export type SettingsSnapshot = Partial<Record<SettingsKey, SettingsValue>>;
```

- [ ] **Step 2: Mirror in sidecar types**

If `sidecar/types.ts` exists, paste the same five declarations at the bottom. If it doesn't exist or doesn't have a clear types file, skip this step — Rust uses `serde_json::Value` and the sidecar isn't wired yet.

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ipc.ts sidecar/types.ts 2>/dev/null || git add src/lib/ipc.ts
git commit -m "feat(ipc): add SettingsKey/Value/Request/Response/Snapshot types"
```

---

## Task 4: `useSettings` store (TDD)

**Files:**
- Create: `src/lib/stores/settings.ts`
- Create: `src/lib/stores/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/stores/settings.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSettings, useSettingsStore, _resetSettingsStoreForTests } from "./settings";

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset().mockResolvedValue({ ok: true });
  _resetSettingsStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSettings", () => {
  it("returns the default value when unset", () => {
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    expect(result.current[0]).toBe("claude");
  });

  it("updates optimistically on set", () => {
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    act(() => result.current[1]("codex"));
    expect(result.current[0]).toBe("codex");
  });

  it("debounces persist calls within 250ms", async () => {
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    act(() => {
      result.current[1]("codex");
      result.current[1]("gemini");
      result.current[1]("aider");
    });
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("settings_write", {
      key: "general.defaultBackend",
      value: "aider",
    });
  });

  it("rolls back when invoke rejects", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    act(() => result.current[1]("codex"));
    expect(result.current[0]).toBe("codex");
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await waitFor(() => expect(result.current[0]).toBe("claude"));
  });

  it("exposes save status transitions: idle -> saving -> saved", async () => {
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    let resolveInvoke!: (v: { ok: true }) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise((res) => { resolveInvoke = res as never; })
    );
    expect(useSettingsStore.getState().status).toBe("idle");
    act(() => result.current[1]("codex"));
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(useSettingsStore.getState().status).toBe("saving");
    await act(async () => {
      resolveInvoke({ ok: true });
      await Promise.resolve();
    });
    expect(useSettingsStore.getState().status).toBe("saved");
  });

  it("rehydrates from settings_read_all", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "settings_read_all") {
        return { "general.defaultBackend": "codex" };
      }
      return { ok: true };
    });
    await act(async () => {
      await useSettingsStore.getState().hydrate();
    });
    const { result } = renderHook(() => useSettings("general.defaultBackend", "claude"));
    expect(result.current[0]).toBe("codex");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/lib/stores/settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/lib/stores/settings.ts`:

```ts
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
      void invoke<SettingsWriteResponse>("settings_write", { key, value: get().values[key] })
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
    // TODO: wire to sidecar settings_read_all
    try {
      const snapshot = await invoke<SettingsSnapshot>("settings_read_all");
      set({ values: snapshot ?? {} });
    } catch {
      set({ values: {} });
    }
  },
}));

export function useSettings<V extends SettingsValue>(
  key: SettingsKey,
  defaultValue: V,
): [V, (value: V) => void] {
  const value = useSettingsStore((s) => (s.values[key] as V | undefined) ?? defaultValue);
  const set = useSettingsStore((s) => s.set);
  return [value, (v: V) => set(key, v)];
}

/** Test-only — clears the store and any pending debounced timers. */
export function _resetSettingsStoreForTests(): void {
  pendingTimers.forEach((t) => clearTimeout(t));
  pendingTimers.clear();
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = null;
  useSettingsStore.setState({ values: {}, status: "idle", lastError: null });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/lib/stores/settings.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/settings.ts src/lib/stores/settings.test.ts
git commit -m "feat(settings): add useSettings store with optimistic debounced persist"
```

---

## Task 5: `SettingsRow` primitive (TDD)

**Files:**
- Create: `src/panels/settings/primitives/SettingsRow.tsx`
- Create: `src/panels/settings/primitives/SettingsRow.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/panels/settings/primitives/SettingsRow.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsRow } from "./SettingsRow";

describe("SettingsRow", () => {
  it("renders title, description, and control", () => {
    renderWithProviders(
      <SettingsRow
        title="Default backend"
        description="The AI CLI used when no preset is specified."
        control={<input data-testid="row-control" />}
      />,
    );
    expect(screen.getByText("Default backend")).toBeInTheDocument();
    expect(
      screen.getByText("The AI CLI used when no preset is specified."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("row-control")).toBeInTheDocument();
  });

  it("omits description block when not provided", () => {
    renderWithProviders(
      <SettingsRow title="Just a title" control={<input />} />,
    );
    expect(screen.getByText("Just a title")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-row-description")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/panels/settings/primitives/SettingsRow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/panels/settings/primitives/SettingsRow.tsx`:

```tsx
import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: string;
  control: ReactNode;
}

export function SettingsRow({ title, description, control }: Props) {
  return (
    <div className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="space-y-0.5">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description ? (
          <div
            data-testid="settings-row-description"
            className="max-w-prose text-xs text-muted-foreground"
          >
            {description}
          </div>
        ) : null}
      </div>
      <div>{control}</div>
    </div>
  );
}
```

- [ ] **Step 4: Verify the test passes**

Run: `bun run test src/panels/settings/primitives/SettingsRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/panels/settings/primitives/SettingsRow.tsx src/panels/settings/primitives/SettingsRow.test.tsx
git commit -m "feat(settings): add SettingsRow primitive"
```

---

## Task 6: `SettingsGroup` primitive (TDD)

**Files:**
- Create: `src/panels/settings/primitives/SettingsGroup.tsx`
- Create: `src/panels/settings/primitives/SettingsGroup.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/panels/settings/primitives/SettingsGroup.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsGroup } from "./SettingsGroup";

describe("SettingsGroup", () => {
  it("renders title, description, and children", () => {
    renderWithProviders(
      <SettingsGroup title="Defaults" description="How new workspaces start.">
        <div data-testid="child-1">A</div>
        <div data-testid="child-2">B</div>
      </SettingsGroup>,
    );
    expect(screen.getByText("Defaults")).toBeInTheDocument();
    expect(screen.getByText("How new workspaces start.")).toBeInTheDocument();
    expect(screen.getByTestId("child-1")).toBeInTheDocument();
    expect(screen.getByTestId("child-2")).toBeInTheDocument();
  });

  it("renders without title or description", () => {
    renderWithProviders(
      <SettingsGroup>
        <div data-testid="only-child">solo</div>
      </SettingsGroup>,
    );
    expect(screen.getByTestId("only-child")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/panels/settings/primitives/SettingsGroup.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/panels/settings/primitives/SettingsGroup.tsx`:

```tsx
import type { ReactNode } from "react";

interface Props {
  title?: string;
  description?: string;
  children: ReactNode;
}

export function SettingsGroup({ title, description, children }: Props) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/40 px-5 py-2">
      {title || description ? (
        <header className="border-b border-border/40 py-3">
          {title ? (
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
              {title}
            </h3>
          ) : null}
          {description ? (
            <p className="mt-1 max-w-prose text-xs text-muted-foreground">{description}</p>
          ) : null}
        </header>
      ) : null}
      <div className="divide-y divide-border/40">{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: Verify**

Run: `bun run test src/panels/settings/primitives/SettingsGroup.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/panels/settings/primitives/SettingsGroup.tsx src/panels/settings/primitives/SettingsGroup.test.tsx
git commit -m "feat(settings): add SettingsGroup primitive"
```

---

## Task 7: `SettingsToggle` primitive (TDD)

**Files:**
- Create: `src/panels/settings/primitives/SettingsToggle.tsx`
- Create: `src/panels/settings/primitives/SettingsToggle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/panels/settings/primitives/SettingsToggle.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsToggle } from "./SettingsToggle";

describe("SettingsToggle", () => {
  it("fires onCheckedChange when clicked", async () => {
    const onCheckedChange = vi.fn();
    renderWithProviders(
      <SettingsToggle
        label="GPG signing"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );
    await userEvent.click(screen.getByRole("switch", { name: /gpg signing/i }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("does not fire when disabled", async () => {
    const onCheckedChange = vi.fn();
    renderWithProviders(
      <SettingsToggle
        label="Telemetry"
        checked={true}
        onCheckedChange={onCheckedChange}
        disabled
      />,
    );
    await userEvent.click(screen.getByRole("switch", { name: /telemetry/i }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/panels/settings/primitives/SettingsToggle.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/panels/settings/primitives/SettingsToggle.tsx`:

```tsx
import { Switch } from "@/components/ui/switch";

interface Props {
  label: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  "data-testid"?: string;
}

export function SettingsToggle({
  label,
  checked,
  onCheckedChange,
  disabled,
  "data-testid": testId,
}: Props) {
  return (
    <Switch
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      data-testid={testId}
    />
  );
}
```

- [ ] **Step 4: Verify**

Run: `bun run test src/panels/settings/primitives/SettingsToggle.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/panels/settings/primitives/SettingsToggle.tsx src/panels/settings/primitives/SettingsToggle.test.tsx
git commit -m "feat(settings): add SettingsToggle wrapping shadcn Switch"
```

---

## Task 8: `SettingsSelect` primitive (TDD)

**Files:**
- Create: `src/panels/settings/primitives/SettingsSelect.tsx`
- Create: `src/panels/settings/primitives/SettingsSelect.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/panels/settings/primitives/SettingsSelect.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsSelect } from "./SettingsSelect";

const OPTIONS = [
  { value: "stable", label: "Stable" },
  { value: "beta", label: "Beta" },
];

describe("SettingsSelect", () => {
  it("renders current value and emits onValueChange on selection", async () => {
    const onValueChange = vi.fn();
    renderWithProviders(
      <SettingsSelect
        label="Update channel"
        value="stable"
        onValueChange={onValueChange}
        options={OPTIONS}
      />,
    );
    expect(screen.getByRole("combobox", { name: /update channel/i })).toHaveTextContent("Stable");
    await userEvent.click(screen.getByRole("combobox", { name: /update channel/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Beta" }));
    expect(onValueChange).toHaveBeenCalledWith("beta");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/panels/settings/primitives/SettingsSelect.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/panels/settings/primitives/SettingsSelect.tsx`:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Option {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string;
  onValueChange: (next: string) => void;
  options: Option[];
  disabled?: boolean;
  "data-testid"?: string;
}

export function SettingsSelect({
  label,
  value,
  onValueChange,
  options,
  disabled,
  "data-testid": testId,
}: Props) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        data-testid={testId}
        className="h-8 w-full max-w-sm border-border/60 bg-muted/50 text-xs hover:bg-muted/70"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-xs">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 4: Verify**

Run: `bun run test src/panels/settings/primitives/SettingsSelect.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/panels/settings/primitives/SettingsSelect.tsx src/panels/settings/primitives/SettingsSelect.test.tsx
git commit -m "feat(settings): add SettingsSelect wrapping shadcn Select"
```

---

## Task 9: `SettingsSearchInput` primitive (TDD)

**Files:**
- Create: `src/panels/settings/primitives/SettingsSearchInput.tsx`
- Create: `src/panels/settings/primitives/SettingsSearchInput.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/panels/settings/primitives/SettingsSearchInput.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsSearchInput } from "./SettingsSearchInput";

describe("SettingsSearchInput", () => {
  it("emits onChange as user types", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <SettingsSearchInput value="" onChange={onChange} />,
    );
    const input = screen.getByRole("searchbox");
    await userEvent.type(input, "a");
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("renders the placeholder", () => {
    renderWithProviders(
      <SettingsSearchInput value="" onChange={() => {}} placeholder="Search…" />,
    );
    expect(screen.getByPlaceholderText("Search…")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/panels/settings/primitives/SettingsSearchInput.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/panels/settings/primitives/SettingsSearchInput.tsx`:

```tsx
import { Search } from "lucide-react";
import { forwardRef } from "react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

export const SettingsSearchInput = forwardRef<HTMLInputElement, Props>(
  function SettingsSearchInput({ value, onChange, placeholder = "Search…" }, ref) {
    return (
      <label className="relative block">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={ref}
          type="search"
          role="searchbox"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 w-full rounded-md border border-border/50 bg-transparent pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        />
      </label>
    );
  },
);
```

- [ ] **Step 4: Verify**

Run: `bun run test src/panels/settings/primitives/SettingsSearchInput.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/panels/settings/primitives/SettingsSearchInput.tsx src/panels/settings/primitives/SettingsSearchInput.test.tsx
git commit -m "feat(settings): add SettingsSearchInput primitive"
```

---

## Task 10: `SettingsHeader` (TDD)

**Files:**
- Create: `src/panels/settings/SettingsHeader.tsx`
- Create: `src/panels/settings/SettingsHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsHeader } from "./SettingsHeader";

describe("SettingsHeader", () => {
  it("renders title and description", () => {
    renderWithProviders(
      <SettingsHeader title="General" description="Defaults for new workspaces." />,
    );
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByText("Defaults for new workspaces.")).toBeInTheDocument();
  });

  it("renders a badge when provided", () => {
    renderWithProviders(
      <SettingsHeader title="Account" badge="Free" />,
    );
    expect(screen.getByText("Free")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test src/panels/settings/SettingsHeader.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
interface Props {
  title: string;
  description?: string;
  badge?: string;
}

export function SettingsHeader({ title, description, badge }: Props) {
  return (
    <header className="mb-5 border-b border-border/40 pb-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {badge ? (
          <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {badge}
          </span>
        ) : null}
      </div>
      {description ? (
        <p className="mt-1 max-w-prose text-xs text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-3 h-px w-full bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
    </header>
  );
}
```

- [ ] **Step 4: Verify**

Run: `bun run test src/panels/settings/SettingsHeader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/panels/settings/SettingsHeader.tsx src/panels/settings/SettingsHeader.test.tsx
git commit -m "feat(settings): add SettingsHeader with gradient hairline"
```

---

## Task 11: `SettingsFooter` (TDD)

**Files:**
- Create: `src/panels/settings/SettingsFooter.tsx`
- Create: `src/panels/settings/SettingsFooter.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsFooter } from "./SettingsFooter";

describe("SettingsFooter", () => {
  it("invokes onOpenFile when Open settings file is clicked", async () => {
    const onOpenFile = vi.fn();
    renderWithProviders(<SettingsFooter status="idle" onOpenFile={onOpenFile} />);
    await userEvent.click(screen.getByRole("button", { name: /open settings file/i }));
    expect(onOpenFile).toHaveBeenCalled();
  });

  it("renders status labels for each state", () => {
    const onOpenFile = vi.fn();
    const { rerender } = renderWithProviders(
      <SettingsFooter status="saving" onOpenFile={onOpenFile} />,
    );
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
    rerender(<SettingsFooter status="saved" onOpenFile={onOpenFile} />);
    expect(screen.getByText(/saved/i)).toBeInTheDocument();
    rerender(<SettingsFooter status="error" onOpenFile={onOpenFile} errorMessage="boom" />);
    expect(screen.getByText(/save failed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/panels/settings/SettingsFooter.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";

type Status = "idle" | "saving" | "saved" | "error";

interface Props {
  status: Status;
  errorMessage?: string;
  onOpenFile: () => void;
}

const STATUS_LABEL: Record<Status, string> = {
  idle: "All changes saved",
  saving: "Saving…",
  saved: "Saved · just now",
  error: "Save failed · retry",
};

const STATUS_TONE: Record<Status, "success" | "warning" | "info" | "destructive" | "muted"> = {
  idle: "muted",
  saving: "info",
  saved: "success",
  error: "destructive",
};

export function SettingsFooter({ status, errorMessage, onOpenFile }: Props) {
  return (
    <footer className="flex h-11 items-center justify-between border-t border-border/40 bg-card/40 px-4">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs"
        onClick={onOpenFile}
      >
        <Code2 className="h-3.5 w-3.5" />
        Open settings file
      </Button>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground" title={errorMessage}>
        <StatusDot tone={STATUS_TONE[status]} />
        <span>{STATUS_LABEL[status]}</span>
      </div>
    </footer>
  );
}
```

(If `StatusDot` doesn't accept a `tone` prop with these values, inspect `src/components/ui/status-dot.tsx` and adapt — fall back to a simple coloured `<span className={cn("h-1.5 w-1.5 rounded-full", toneClass)} />` if needed.)

- [ ] **Step 4: Verify**

Run: `bun run test src/panels/settings/SettingsFooter.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/panels/settings/SettingsFooter.tsx src/panels/settings/SettingsFooter.test.tsx
git commit -m "feat(settings): add SettingsFooter with open-file + sync status"
```

---

## Task 12: `SettingsNavRail` (TDD)

**Files:**
- Create: `src/panels/settings/SettingsNavRail.tsx`
- Create: `src/panels/settings/SettingsNavRail.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsNavRail, NAV_GROUPS } from "./SettingsNavRail";

describe("SettingsNavRail", () => {
  it("renders all groups and items", () => {
    renderWithProviders(
      <SettingsNavRail section="general" onSelect={() => {}} />,
    );
    for (const group of NAV_GROUPS) {
      expect(screen.getByText(group.label)).toBeInTheDocument();
      for (const item of group.items) {
        expect(screen.getByTestId(`settings-nav-${item.id}`)).toBeInTheDocument();
      }
    }
  });

  it("marks the selected item with aria-current", () => {
    renderWithProviders(
      <SettingsNavRail section="account" onSelect={() => {}} />,
    );
    expect(screen.getByTestId("settings-nav-account")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("settings-nav-general")).not.toHaveAttribute("aria-current", "page");
  });

  it("calls onSelect when an item is clicked", async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <SettingsNavRail section="general" onSelect={onSelect} />,
    );
    await userEvent.click(screen.getByTestId("settings-nav-models"));
    expect(onSelect).toHaveBeenCalledWith("models");
  });

  it("filters items by search query", async () => {
    renderWithProviders(
      <SettingsNavRail section="general" onSelect={() => {}} />,
    );
    await userEvent.type(screen.getByRole("searchbox"), "git");
    expect(screen.getByTestId("settings-nav-git")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-nav-models")).toBeNull();
  });

  it("keeps the selected group header visible even when its children filter out", async () => {
    renderWithProviders(
      <SettingsNavRail section="account" onSelect={() => {}} />,
    );
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("SYSTEM")).toBeInTheDocument();
  });

  it("moves selection on arrow keys and fires onSelect on Enter", async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <SettingsNavRail section="general" onSelect={onSelect} />,
    );
    const search = screen.getByRole("searchbox");
    search.focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalled();
    const first = onSelect.mock.calls[0][0];
    expect(typeof first).toBe("string");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/panels/settings/SettingsNavRail.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import {
  Bell,
  Cpu,
  FolderGit2,
  GitBranch,
  Keyboard,
  Palette,
  Plug,
  Server,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Terminal,
  User,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SettingsSearchInput } from "./primitives/SettingsSearchInput";

export type SectionId =
  | "general"
  | "repositories"
  | "git"
  | "models"
  | "providers"
  | "mcps"
  | "appearance"
  | "keybindings"
  | "terminal"
  | "notifications"
  | "advanced"
  | "account";

interface NavItem {
  id: SectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "WORKSPACE",
    items: [
      { id: "general", label: "General", icon: SettingsIcon },
      { id: "repositories", label: "Repositories", icon: FolderGit2 },
      { id: "git", label: "Git", icon: GitBranch },
    ],
  },
  {
    id: "ai",
    label: "AI",
    items: [
      { id: "models", label: "Models", icon: Cpu },
      { id: "providers", label: "Providers", icon: Plug },
      { id: "mcps", label: "MCPs", icon: Server },
    ],
  },
  {
    id: "editor",
    label: "EDITOR",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "keybindings", label: "Keybindings", icon: Keyboard },
      { id: "terminal", label: "Terminal", icon: Terminal },
    ],
  },
  {
    id: "system",
    label: "SYSTEM",
    items: [
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
      { id: "account", label: "Account", icon: User },
    ],
  },
];

interface Props {
  section: SectionId;
  onSelect: (id: SectionId) => void;
}

export function SettingsNavRail({ section, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const itemRefs = useRef<Map<SectionId, HTMLButtonElement>>(new Map());

  const groupsToRender = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NAV_GROUPS.map((group) => {
      const filtered = q
        ? group.items.filter((item) => item.label.toLowerCase().includes(q))
        : group.items;
      const containsSelected = group.items.some((item) => item.id === section);
      return {
        ...group,
        items: filtered,
        renderHeader: filtered.length > 0 || containsSelected,
      };
    });
  }, [query, section]);

  const visibleIds = useMemo(
    () => groupsToRender.flatMap((g) => g.items.map((i) => i.id)),
    [groupsToRender],
  );

  const handleSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "Enter") return;
    if (visibleIds.length === 0) return;
    e.preventDefault();
    if (e.key === "ArrowDown") {
      itemRefs.current.get(visibleIds[0])?.focus();
    } else {
      onSelect(visibleIds[0]);
    }
  };

  const handleItemKey = (e: KeyboardEvent<HTMLButtonElement>, id: SectionId) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    e.preventDefault();
    if (e.key === "Enter") {
      onSelect(id);
      return;
    }
    const idx = visibleIds.indexOf(id);
    const next = e.key === "ArrowDown" ? visibleIds[idx + 1] : visibleIds[idx - 1];
    if (next) itemRefs.current.get(next)?.focus();
  };

  return (
    <nav
      aria-label="Settings sections"
      onKeyDownCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.getAttribute("role") === "searchbox") {
          handleSearchKey(e as unknown as KeyboardEvent<HTMLInputElement>);
        }
      }}
      className="flex h-full w-settings-nav flex-col gap-2 border-r border-border/30 bg-card/40 px-2 py-3"
    >
      <div className="px-1">
        <SettingsSearchInput value={query} onChange={setQuery} placeholder="Search…" />
      </div>
      <div className="flex-1 overflow-y-auto">
        {groupsToRender.map((group) =>
          group.renderHeader ? (
            <div key={group.id} className="mb-2">
              <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                {group.label}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const selected = item.id === section;
                return (
                  <button
                    key={item.id}
                    ref={(node) => {
                      if (node) itemRefs.current.set(item.id, node);
                      else itemRefs.current.delete(item.id);
                    }}
                    type="button"
                    data-testid={`settings-nav-${item.id}`}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => onSelect(item.id)}
                    onKeyDown={(e) => handleItemKey(e, item.id)}
                    className={cn(
                      "relative flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors",
                      selected
                        ? "bg-accent/15 text-foreground"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    {selected ? (
                      <motion.span
                        layoutId="settings-nav-indicator"
                        className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-sm bg-accent"
                      />
                    ) : null}
                    <Icon className="h-3.5 w-3.5" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null,
        )}
      </div>
    </nav>
  );
}

export type { NavGroup, NavItem };
```

- [ ] **Step 4: Verify**

Run: `bun run test src/panels/settings/SettingsNavRail.test.tsx`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/panels/settings/SettingsNavRail.tsx src/panels/settings/SettingsNavRail.test.tsx
git commit -m "feat(settings): add SettingsNavRail with search and keyboard nav"
```

---

## Task 13: `SettingsPanel` shell rewrite

**Files:**
- Modify: `src/panels/settings/SettingsPanel.tsx` (full rewrite)
- Modify: `src/panels/settings/SettingsPanel.test.tsx` (rewrite — section-switching kept)
- Create: `src/panels/settings/sections/ProvidersSettings.tsx` (extracted from inline)

- [ ] **Step 1: Extract `ProvidersSettings` to its own file**

Create `src/panels/settings/sections/ProvidersSettings.tsx`:

```tsx
export default function ProvidersSettings() {
  return (
    <section data-testid="providers-settings" className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Configure API keys for each backend. Keys are stored in your system keychain.
      </p>
      <div className="rounded-md border border-border/60 bg-card/40 p-3 text-[11px] text-muted-foreground">
        Provider configuration is managed via the OS keychain. Use{" "}
        <code className="rounded bg-muted/40 px-1 font-mono">
          maverick keys set &lt;provider&gt;
        </code>{" "}
        from a terminal or the workspace command palette.
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Rewrite `SettingsPanel.tsx`**

Replace the entire contents of `src/panels/settings/SettingsPanel.tsx` with:

```tsx
// ⌘, — Settings dialog. Owns selected section + URL persistence.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useSettingsStore } from "@/lib/stores/settings";
import { open as openInShell } from "@tauri-apps/plugin-shell";
import { SettingsNavRail, NAV_GROUPS, type SectionId } from "./SettingsNavRail";
import { SettingsHeader } from "./SettingsHeader";
import { SettingsFooter } from "./SettingsFooter";
import GeneralSettings from "./sections/GeneralSettings";
import ModelsSettings from "./sections/ModelsSettings";
import ProvidersSettings from "./sections/ProvidersSettings";
import AppearanceSettings from "./sections/AppearanceSettings";
import KeybindingsSettings from "./sections/KeybindingsSettings";
import TerminalPresets from "./sections/TerminalPresets";
import RepositorySettings from "./sections/RepositorySettings";
import NotificationsSettings from "./sections/NotificationsSettings";
import AdvancedSettings from "./sections/AdvancedSettings";
import GitSettings from "./sections/GitSettings";
import MCPsSettings from "./sections/MCPsSettings";
import AccountSettings from "./sections/AccountSettings";

interface SectionMeta {
  title: string;
  description: string;
  badge?: string;
  Component: React.ComponentType;
}

const SECTIONS: Record<SectionId, SectionMeta> = {
  general: {
    title: "General",
    description: "Defaults for new workspaces, base branches, and startup behaviour.",
    Component: GeneralSettings,
  },
  repositories: {
    title: "Repositories",
    description: "Per-repository overrides for presets and ignored paths.",
    Component: RepositorySettings,
  },
  git: {
    title: "Git",
    description: "Remote, commit template, auto-fetch, and signing preferences.",
    Component: GitSettings,
  },
  models: {
    title: "Models",
    description: "Model IDs, context windows, and per-token cost per backend.",
    Component: ModelsSettings,
  },
  providers: {
    title: "Providers",
    description: "Backend credentials read from each CLI's own config.",
    Component: ProvidersSettings,
  },
  mcps: {
    title: "MCP Servers",
    description: "Globally enabled MCP servers and their environment.",
    Component: MCPsSettings,
  },
  appearance: {
    title: "Appearance",
    description: "Theme, font sizes, ligatures, and animations.",
    Component: AppearanceSettings,
  },
  keybindings: {
    title: "Keybindings",
    description: "Every shortcut Maverick listens for. Rebinding lands in a later release.",
    Component: KeybindingsSettings,
  },
  terminal: {
    title: "Terminal Presets",
    description: "Named PTY launchers usable from the preset launcher (⌘⇧Space).",
    Component: TerminalPresets,
  },
  notifications: {
    title: "Notifications",
    description: "Per-event notification toggles.",
    Component: NotificationsSettings,
  },
  advanced: {
    title: "Advanced",
    description: "Performance limits, power management, telemetry.",
    Component: AdvancedSettings,
  },
  account: {
    title: "Account",
    description: "License, plan, and update channel.",
    badge: "Free",
    Component: AccountSettings,
  },
};

const ALL_IDS: SectionId[] = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));

function readSectionFromUrl(): SectionId {
  if (typeof window === "undefined") return "general";
  const id = new URLSearchParams(window.location.search).get("settings");
  return (ALL_IDS as string[]).includes(id ?? "") ? (id as SectionId) : "general";
}

interface Props {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
}

export default function SettingsPanel({ open, onOpenChange, onClose }: Props) {
  const [section, setSection] = useState<SectionId>(readSectionFromUrl());
  const status = useSettingsStore((s) => s.status);
  const lastError = useSettingsStore((s) => s.lastError);
  const isOpen = open ?? true;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("settings", section);
    window.history.replaceState({}, "", url.toString());
  }, [section]);

  const meta = SECTIONS[section];
  const ContentComponent = useMemo(() => meta.Component, [meta]);

  const handleOpenChange = (next: boolean) => {
    onOpenChange?.(next);
    if (!next) onClose?.();
  };

  const handleOpenFile = () => {
    void openInShell("file://~/.config/maverick/settings.json").catch(() => {
      // TODO: open via EditorArea once we have a "open path in editor" command
      console.warn("Could not open settings file");
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="settings-panel"
        className="grid h-[min(680px,86vh)] w-[min(960px,92vw)] max-w-settings-modal grid-cols-[var(--settings-nav-width)_1fr] grid-rows-[1fr_auto] gap-0 overflow-hidden border border-border-glass-strong/100 bg-popover/95 p-0 shadow-modal backdrop-blur-xl"
      >
        <DialogTitle className="sr-only">{meta.title}</DialogTitle>
        <DialogDescription className="sr-only">{meta.description}</DialogDescription>
        <div className="row-span-2 border-r border-border/30">
          <SettingsNavRail section={section} onSelect={setSection} />
        </div>
        <div className="overflow-y-auto px-8 py-6">
          <SettingsHeader title={meta.title} description={meta.description} badge={meta.badge} />
          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <ContentComponent />
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="col-start-2">
          <SettingsFooter
            status={status}
            errorMessage={lastError ?? undefined}
            onOpenFile={handleOpenFile}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Rewrite the integration test**

Replace `src/panels/settings/SettingsPanel.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import SettingsPanel from "./SettingsPanel";

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
  window.history.replaceState({}, "", "/");
});

describe("SettingsPanel", () => {
  it("renders the panel and starts on General", () => {
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
    expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
    expect(screen.getByTestId("general-settings")).toBeInTheDocument();
  });

  it("switches to each section via nav", async () => {
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
    const sections: Array<[string, string]> = [
      ["settings-nav-models", "models-settings"],
      ["settings-nav-providers", "providers-settings"],
      ["settings-nav-appearance", "appearance-settings"],
      ["settings-nav-notifications", "notifications-settings"],
      ["settings-nav-keybindings", "keybindings-settings"],
      ["settings-nav-git", "git-settings"],
      ["settings-nav-mcps", "mcps-settings"],
      ["settings-nav-advanced", "advanced-settings"],
      ["settings-nav-account", "account-settings"],
      ["settings-nav-terminal", "terminal-presets"],
      ["settings-nav-repositories", "repository-settings"],
      ["settings-nav-general", "general-settings"],
    ];
    for (const [nav, sec] of sections) {
      await userEvent.click(screen.getByTestId(nav));
      expect(screen.getByTestId(sec)).toBeInTheDocument();
    }
  });

  it("persists section to ?settings= URL param", async () => {
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
    await userEvent.click(screen.getByTestId("settings-nav-account"));
    expect(new URLSearchParams(window.location.search).get("settings")).toBe("account");
  });

  it("restores the section from ?settings= on mount", () => {
    window.history.replaceState({}, "", "/?settings=appearance");
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
    expect(screen.getByTestId("appearance-settings")).toBeInTheDocument();
  });

  it("supports controlled open/onOpenChange", async () => {
    const onOpenChange = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <SettingsPanel open onOpenChange={onOpenChange} onClose={onClose} />,
    );
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `bun run test src/panels/settings/SettingsPanel.test.tsx`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/panels/settings/SettingsPanel.tsx src/panels/settings/SettingsPanel.test.tsx src/panels/settings/sections/ProvidersSettings.tsx
git commit -m "feat(settings): rewrite SettingsPanel shell with glass modal, nav rail, header, footer, URL persistence"
```

---

## Task 14: Rewrite `GeneralSettings`

**Files:**
- Modify: `src/panels/settings/sections/GeneralSettings.tsx`
- Modify: `src/panels/settings/sections/GeneralSettings.test.tsx`

- [ ] **Step 1: Update the test (existing pattern preserved)**

Replace the contents of `src/panels/settings/sections/GeneralSettings.test.tsx` with:

```tsx
import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import GeneralSettings from "./GeneralSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("GeneralSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("renders and lets user edit all fields including restore toggle", async () => {
    renderWithProviders(<GeneralSettings />);
    fireEvent.change(screen.getByTestId("general-default-backend"), { target: { value: "codex" } });
    expect(screen.getByTestId("general-default-backend")).toHaveValue("codex");
    fireEvent.change(screen.getByTestId("general-default-branch"), { target: { value: "develop" } });
    expect(screen.getByTestId("general-default-branch")).toHaveValue("develop");
    fireEvent.change(screen.getByTestId("general-naming"), { target: { value: "{backend}" } });
    expect(screen.getByTestId("general-naming")).toHaveValue("{backend}");
    const toggle = screen.getByRole("switch", { name: /restore last session/i });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
  });
});
```

(Note: import `beforeEach` from `vitest` if not auto-injected — adjust as needed.)

- [ ] **Step 2: Rewrite the section**

Replace the contents of `src/panels/settings/sections/GeneralSettings.tsx` with:

```tsx
import { Input } from "@/components/ui/input";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsToggle } from "../primitives/SettingsToggle";
import { useSettings } from "@/lib/stores/settings";

export default function GeneralSettings() {
  const [defaultBackend, setDefaultBackend] = useSettings("general.defaultBackend", "claude");
  const [defaultBranch, setDefaultBranch] = useSettings("general.defaultBranch", "origin/main");
  const [namingScheme, setNamingScheme] = useSettings("general.namingScheme", "{branch}");
  const [restore, setRestore] = useSettings("general.restoreSession", true);

  return (
    <div data-testid="general-settings" className="space-y-5">
      <SettingsGroup title="Defaults" description="Applied when a workspace is created without a preset.">
        <SettingsRow
          title="Default backend"
          description="The AI CLI used when no backend is specified in the preset."
          control={
            <Input
              data-testid="general-default-backend"
              value={defaultBackend}
              onChange={(e) => setDefaultBackend(e.target.value)}
              className="max-w-sm"
            />
          }
        />
        <SettingsRow
          title="Default base branch"
          description="New worktrees are forked from this branch."
          control={
            <Input
              data-testid="general-default-branch"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              className="max-w-sm"
            />
          }
        />
        <SettingsRow
          title="Workspace naming scheme"
          description="Tokens: {branch}, {backend}, {date}."
          control={
            <Input
              data-testid="general-naming"
              value={namingScheme}
              onChange={(e) => setNamingScheme(e.target.value)}
              placeholder="{branch} or {backend}-{date}"
              className="max-w-sm"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Startup">
        <SettingsRow
          title="Restore last session on startup"
          description="Re-open the workspaces that were active when you last closed Maverick."
          control={
            <SettingsToggle
              label="Restore last session"
              checked={restore as boolean}
              onCheckedChange={setRestore}
              data-testid="general-restore"
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `bun run test src/panels/settings/sections/GeneralSettings.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/panels/settings/sections/GeneralSettings.tsx src/panels/settings/sections/GeneralSettings.test.tsx
git commit -m "feat(settings): rewrite GeneralSettings against new primitives + store"
```

---

## Task 15: Rewrite `AppearanceSettings`

**Files:**
- Modify: `src/panels/settings/sections/AppearanceSettings.tsx`
- Modify: `src/panels/settings/sections/AppearanceSettings.test.tsx`

- [ ] **Step 1: Update the test**

Replace `src/panels/settings/sections/AppearanceSettings.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import AppearanceSettings from "./AppearanceSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("AppearanceSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("selects a theme, adjusts font sizes, toggles ligatures and animations", async () => {
    renderWithProviders(<AppearanceSettings />);
    await userEvent.click(screen.getByTestId("theme-rose-pine"));
    expect(screen.getByTestId("theme-rose-pine")).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByTestId("ui-font-size"), { target: { value: "14" } });
    expect(screen.getByText(/UI font size \(14px\)/i)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("terminal-font-size"), { target: { value: "15" } });
    expect(screen.getByText(/Terminal font size \(15px\)/i)).toBeInTheDocument();

    const ligatures = screen.getByRole("switch", { name: /ligatures/i });
    expect(ligatures).toBeChecked();
    await userEvent.click(ligatures);
    expect(ligatures).not.toBeChecked();

    const animations = screen.getByRole("switch", { name: /animations/i });
    await userEvent.click(animations);
    expect(animations).not.toBeChecked();
  });
});
```

- [ ] **Step 2: Rewrite the section**

Replace `src/panels/settings/sections/AppearanceSettings.tsx` with:

```tsx
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsToggle } from "../primitives/SettingsToggle";
import { useSettings } from "@/lib/stores/settings";
import { cn } from "@/lib/utils";

interface ThemePreview {
  id: string;
  name: string;
  background: string;
  foreground: string;
  accent: string;
}

const THEMES: ThemePreview[] = [
  { id: "pure-black", name: "Pure Black", background: "#000000", foreground: "#ffffff", accent: "#7c3aed" },
  { id: "graphite", name: "Graphite", background: "#0c0c0c", foreground: "#e7e7e7", accent: "#22d3ee" },
  { id: "nord", name: "Nord", background: "#2e3440", foreground: "#eceff4", accent: "#88c0d0" },
  { id: "rose-pine", name: "Rosé Pine", background: "#191724", foreground: "#e0def4", accent: "#eb6f92" },
  { id: "solarized-light", name: "Solarized Light", background: "#fdf6e3", foreground: "#073642", accent: "#268bd2" },
];

export default function AppearanceSettings() {
  const [theme, setTheme] = useSettings("appearance.theme", "pure-black");
  const [uiFontSize, setUiFontSize] = useSettings("appearance.uiFontSize", 12);
  const [terminalFontSize, setTerminalFontSize] = useSettings("appearance.terminalFontSize", 13);
  const [ligatures, setLigatures] = useSettings("appearance.ligatures", true);
  const [animations, setAnimations] = useSettings("appearance.animations", true);

  return (
    <div data-testid="appearance-settings" className="space-y-5">
      <SettingsGroup title="Theme" description="Affects UI surfaces, terminal palette, and syntax colors.">
        <div className="py-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {THEMES.map((t) => {
              const selected = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  data-testid={`theme-${t.id}`}
                  aria-pressed={selected}
                  className={cn(
                    "flex flex-col gap-1 rounded-md border p-2 text-left text-[11px] transition-colors",
                    selected
                      ? "border-accent ring-1 ring-accent/60"
                      : "border-border/60 hover:border-border",
                  )}
                >
                  <div
                    className="h-10 w-full rounded border border-border/60"
                    style={{ background: t.background }}
                  >
                    <div className="flex h-full items-center justify-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ background: t.foreground }} />
                      <span className="h-2 w-2 rounded-full" style={{ background: t.accent }} />
                    </div>
                  </div>
                  <span>{t.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Typography">
        <SettingsRow
          title={`UI font size (${uiFontSize}px)`}
          control={
            <input
              type="range"
              min={10}
              max={18}
              value={uiFontSize as number}
              data-testid="ui-font-size"
              onChange={(e) => setUiFontSize(Number(e.target.value))}
              className="w-full max-w-sm"
            />
          }
        />
        <SettingsRow
          title={`Terminal font size (${terminalFontSize}px)`}
          control={
            <input
              type="range"
              min={10}
              max={20}
              value={terminalFontSize as number}
              data-testid="terminal-font-size"
              onChange={(e) => setTerminalFontSize(Number(e.target.value))}
              className="w-full max-w-sm"
            />
          }
        />
        <SettingsRow
          title="Font ligatures"
          control={
            <SettingsToggle
              label="Ligatures"
              checked={ligatures as boolean}
              onCheckedChange={setLigatures}
              data-testid="ligatures-toggle"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Motion">
        <SettingsRow
          title="Animations"
          description="Honors system 'reduce motion' regardless of this setting."
          control={
            <SettingsToggle
              label="Animations"
              checked={animations as boolean}
              onCheckedChange={setAnimations}
              data-testid="animations-toggle"
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `bun run test src/panels/settings/sections/AppearanceSettings.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/panels/settings/sections/AppearanceSettings.tsx src/panels/settings/sections/AppearanceSettings.test.tsx
git commit -m "feat(settings): rewrite AppearanceSettings with theme cards + groups"
```

---

## Task 16: Rewrite `NotificationsSettings`

**Files:**
- Modify: `src/panels/settings/sections/NotificationsSettings.tsx`
- Modify: `src/panels/settings/sections/NotificationsSettings.test.tsx`

- [ ] **Step 1: Update the test**

Replace `src/panels/settings/sections/NotificationsSettings.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import NotificationsSettings from "./NotificationsSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("NotificationsSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("renders all notification toggles and flips one", async () => {
    renderWithProviders(<NotificationsSettings />);
    const toggle = screen.getByRole("switch", { name: /agent waiting for input/i });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
  });
});
```

- [ ] **Step 2: Rewrite**

Replace `src/panels/settings/sections/NotificationsSettings.tsx` with:

```tsx
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsToggle } from "../primitives/SettingsToggle";
import { useSettings } from "@/lib/stores/settings";
import type { SettingsKey } from "@/lib/ipc";

interface NotifSetting {
  key: SettingsKey;
  label: string;
  description: string;
}

const NOTIFS: NotifSetting[] = [
  { key: "notifications.agent.waiting", label: "Agent waiting for input", description: "Notify when an agent pauses for stdin." },
  { key: "notifications.agent.complete", label: "Agent task complete", description: "Summary when a task finishes." },
  { key: "notifications.agent.error", label: "Agent error / crash", description: "Red notification on failure." },
  { key: "notifications.build.result", label: "Build / test result", description: "Pass/fail notification when run scripts complete." },
  { key: "notifications.quota.warning", label: "Quota warning", description: "Notify at 80% and 100% of quota." },
];

function NotifToggle({ s }: { s: NotifSetting }) {
  const [checked, setChecked] = useSettings(s.key, true);
  return (
    <SettingsRow
      title={s.label}
      description={s.description}
      control={
        <SettingsToggle
          label={s.label}
          checked={checked as boolean}
          onCheckedChange={setChecked}
          data-testid={`notif-${s.key}`}
        />
      }
    />
  );
}

export default function NotificationsSettings() {
  return (
    <div data-testid="notifications-settings" className="space-y-5">
      <SettingsGroup>
        {NOTIFS.map((s) => (
          <NotifToggle key={s.key} s={s} />
        ))}
      </SettingsGroup>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `bun run test src/panels/settings/sections/NotificationsSettings.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/panels/settings/sections/NotificationsSettings.tsx src/panels/settings/sections/NotificationsSettings.test.tsx
git commit -m "feat(settings): rewrite NotificationsSettings with shared primitives"
```

---

## Task 17: Rewrite `GitSettings`

**Files:**
- Modify: `src/panels/settings/sections/GitSettings.tsx`
- Modify: `src/panels/settings/sections/GitSettings.test.tsx`

- [ ] **Step 1: Update the test**

Replace `src/panels/settings/sections/GitSettings.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import GitSettings from "./GitSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("GitSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("edits remote, template, auto-fetch, and toggles GPG", async () => {
    renderWithProviders(<GitSettings />);
    fireEvent.change(screen.getByTestId("git-remote"), { target: { value: "upstream" } });
    expect(screen.getByTestId("git-remote")).toHaveValue("upstream");

    fireEvent.change(screen.getByTestId("git-template"), { target: { value: "feat: \n\nWhy:" } });
    expect(screen.getByTestId("git-template")).toHaveValue("feat: \n\nWhy:");

    fireEvent.change(screen.getByTestId("git-autofetch"), { target: { value: "10" } });
    expect(screen.getByTestId("git-autofetch")).toHaveValue(10);

    const gpg = screen.getByRole("switch", { name: /gpg signing/i });
    expect(gpg).not.toBeChecked();
    await userEvent.click(gpg);
    expect(gpg).toBeChecked();
  });
});
```

- [ ] **Step 2: Rewrite**

Replace `src/panels/settings/sections/GitSettings.tsx` with:

```tsx
import { Input } from "@/components/ui/input";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsToggle } from "../primitives/SettingsToggle";
import { useSettings } from "@/lib/stores/settings";

export default function GitSettings() {
  const [remote, setRemote] = useSettings("git.remote", "origin");
  const [template, setTemplate] = useSettings("git.template", "");
  const [autoFetch, setAutoFetch] = useSettings("git.autoFetchMinutes", 5);
  const [gpg, setGpg] = useSettings("git.gpgSign", false);

  return (
    <div data-testid="git-settings" className="space-y-5">
      <SettingsGroup title="Remote">
        <SettingsRow
          title="Default remote"
          description="Used by Push / Pull and 'Auto-fetch'."
          control={
            <Input
              data-testid="git-remote"
              value={remote as string}
              onChange={(e) => setRemote(e.target.value)}
              className="max-w-sm"
            />
          }
        />
        <SettingsRow
          title="Auto-fetch interval"
          description="Minutes between background `git fetch`. Set to 0 to disable."
          control={
            <Input
              type="number"
              min={0}
              data-testid="git-autofetch"
              value={autoFetch as number}
              onChange={(e) => setAutoFetch(Number(e.target.value))}
              className="max-w-[120px]"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Commits">
        <SettingsRow
          title="Commit message template"
          description="Prefilled into the message buffer when staging a commit."
          control={
            <textarea
              data-testid="git-template"
              value={template as string}
              onChange={(e) => setTemplate(e.target.value)}
              rows={3}
              className="w-full max-w-lg resize-none rounded-sm border border-border bg-input p-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          }
        />
        <SettingsRow
          title="GPG signing"
          description="Sign every commit with the configured GPG key."
          control={
            <SettingsToggle
              label="GPG signing"
              checked={gpg as boolean}
              onCheckedChange={setGpg}
              data-testid="git-gpg"
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `bun run test src/panels/settings/sections/GitSettings.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/panels/settings/sections/GitSettings.tsx src/panels/settings/sections/GitSettings.test.tsx
git commit -m "feat(settings): rewrite GitSettings with new primitives"
```

---

## Task 18: Rewrite `AdvancedSettings`

**Files:**
- Modify: `src/panels/settings/sections/AdvancedSettings.tsx`
- Modify: `src/panels/settings/sections/AdvancedSettings.test.tsx`

- [ ] **Step 1: Update the test**

Replace `src/panels/settings/sections/AdvancedSettings.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import AdvancedSettings from "./AdvancedSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("AdvancedSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("edits numeric fields and toggles caffeinate + telemetry", async () => {
    renderWithProviders(<AdvancedSettings />);
    fireEvent.change(screen.getByTestId("advanced-largetext"), { target: { value: "10000" } });
    expect(screen.getByTestId("advanced-largetext")).toHaveValue(10000);

    fireEvent.change(screen.getByTestId("advanced-lru"), { target: { value: "12" } });
    expect(screen.getByTestId("advanced-lru")).toHaveValue(12);

    const caf = screen.getByRole("switch", { name: /caffeinate/i });
    expect(caf).toBeChecked();
    await userEvent.click(caf);
    expect(caf).not.toBeChecked();

    const tel = screen.getByRole("switch", { name: /telemetry/i });
    expect(tel).not.toBeChecked();
    await userEvent.click(tel);
    expect(tel).toBeChecked();
  });
});
```

- [ ] **Step 2: Rewrite**

Replace `src/panels/settings/sections/AdvancedSettings.tsx` with:

```tsx
import { Input } from "@/components/ui/input";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsToggle } from "../primitives/SettingsToggle";
import { useSettings } from "@/lib/stores/settings";

export default function AdvancedSettings() {
  const [largeText, setLargeText] = useSettings("advanced.largeTextThreshold", 5000);
  const [lruLimit, setLruLimit] = useSettings("advanced.lruLimit", 8);
  const [caffeinate, setCaffeinate] = useSettings("advanced.caffeinate", true);
  const [telemetry, setTelemetry] = useSettings("advanced.telemetry", false);

  return (
    <div data-testid="advanced-settings" className="space-y-5">
      <SettingsGroup title="Performance">
        <SettingsRow
          title="Large text threshold"
          description="Characters above which we render a single-line preview instead of the full file."
          control={
            <Input
              type="number"
              min={500}
              data-testid="advanced-largetext"
              value={largeText as number}
              onChange={(e) => setLargeText(Number(e.target.value))}
              className="max-w-[140px]"
            />
          }
        />
        <SettingsRow
          title="LRU workspace limit"
          description="Number of inactive workspaces kept hot in memory."
          control={
            <Input
              type="number"
              min={1}
              data-testid="advanced-lru"
              value={lruLimit as number}
              onChange={(e) => setLruLimit(Number(e.target.value))}
              className="max-w-[140px]"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="System">
        <SettingsRow
          title="Caffeinate while agents are running"
          description="Prevent the system from sleeping when any agent process is active."
          control={
            <SettingsToggle
              label="Caffeinate"
              checked={caffeinate as boolean}
              onCheckedChange={setCaffeinate}
              data-testid="advanced-caffeinate"
            />
          }
        />
        <SettingsRow
          title="Telemetry"
          description="Anonymous usage metrics. Off by default."
          control={
            <SettingsToggle
              label="Telemetry"
              checked={telemetry as boolean}
              onCheckedChange={setTelemetry}
              data-testid="advanced-telemetry"
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `bun run test src/panels/settings/sections/AdvancedSettings.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/panels/settings/sections/AdvancedSettings.tsx src/panels/settings/sections/AdvancedSettings.test.tsx
git commit -m "feat(settings): rewrite AdvancedSettings with new primitives"
```

---

## Task 19: Rewrite `AccountSettings`

**Files:**
- Modify: `src/panels/settings/sections/AccountSettings.tsx`
- Modify: `src/panels/settings/sections/AccountSettings.test.tsx`

- [ ] **Step 1: Update the test**

Replace `src/panels/settings/sections/AccountSettings.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import AccountSettings from "./AccountSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("AccountSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("edits license, switches channel via select", async () => {
    renderWithProviders(<AccountSettings />);
    fireEvent.change(screen.getByTestId("account-license"), { target: { value: "ABCD-EFGH-IJKL-MNOP" } });
    expect(screen.getByTestId("account-license")).toHaveValue("ABCD-EFGH-IJKL-MNOP");
    expect(screen.getByTestId("account-plan")).toHaveTextContent(/Pro/i);

    await userEvent.click(screen.getByRole("combobox", { name: /update channel/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Beta" }));
    expect(screen.getByRole("combobox", { name: /update channel/i })).toHaveTextContent("Beta");
  });
});
```

- [ ] **Step 2: Rewrite**

Replace `src/panels/settings/sections/AccountSettings.tsx` with:

```tsx
import { Input } from "@/components/ui/input";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { useSettings } from "@/lib/stores/settings";

const CHANNELS = [
  { value: "stable", label: "Stable" },
  { value: "beta", label: "Beta" },
];

export default function AccountSettings() {
  const [license, setLicense] = useSettings("account.licenseKey", "");
  const [channel, setChannel] = useSettings("account.updateChannel", "stable");
  const plan = (license as string).length > 0 ? "Pro" : "Free";

  return (
    <div data-testid="account-settings" className="space-y-5">
      <SettingsGroup title="License">
        <SettingsRow
          title="License key"
          description="Stored locally. Paste a key to upgrade to Pro."
          control={
            <Input
              type="password"
              value={license as string}
              onChange={(e) => setLicense(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              data-testid="account-license"
              className="max-w-sm"
            />
          }
        />
        <SettingsRow
          title="Plan"
          control={
            <span className="text-xs text-foreground" data-testid="account-plan">
              {plan}
            </span>
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Updates">
        <SettingsRow
          title="Update channel"
          description="Beta gets new features first, but with rougher edges."
          control={
            <SettingsSelect
              label="Update channel"
              value={channel as string}
              onValueChange={setChannel}
              options={CHANNELS}
              data-testid="account-channel"
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `bun run test src/panels/settings/sections/AccountSettings.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/panels/settings/sections/AccountSettings.tsx src/panels/settings/sections/AccountSettings.test.tsx
git commit -m "feat(settings): rewrite AccountSettings with new primitives + Select"
```

---

## Task 20: Polish sections with custom layouts (`Models`, `Keybindings`, `MCPs`, `Repositories`, `Terminal`)

These sections don't use the standard `Row` pattern — they have tables, panel-embeds, or master/detail layouts. They only need the existing inline section heading (`h3.text-sm…`) removed (since `SettingsHeader` now owns the title) and their outer container tightened.

**Files (each modified the same way):**
- `src/panels/settings/sections/ModelsSettings.tsx`
- `src/panels/settings/sections/KeybindingsSettings.tsx`
- `src/panels/settings/sections/MCPsSettings.tsx`
- `src/panels/settings/sections/RepositorySettings.tsx`
- `src/panels/settings/sections/TerminalPresets.tsx`

- [ ] **Step 1: Remove duplicate heading lines**

In each of the 5 files above, delete the `<h3 className="text-sm font-medium text-foreground">…</h3>` line — the new `SettingsHeader` rendered by `SettingsPanel` is the title now. Leave everything else intact.

- [ ] **Step 2: Verify section tests still pass for the ones that have tests**

Run: `bun run test src/panels/settings/sections/ModelsSettings.test.tsx src/panels/settings/sections/KeybindingsSettings.test.tsx src/panels/settings/sections/MCPsSettings.test.tsx src/panels/settings/sections/RepositorySettings.test.tsx`
Expected: PASS.

If a test asserts on the removed `<h3>` content, change the assertion to look up the new header inside `SettingsPanel` integration tests instead — or delete the assertion (the integration test already covers titles).

- [ ] **Step 3: Commit**

```bash
git add src/panels/settings/sections/ModelsSettings.tsx src/panels/settings/sections/KeybindingsSettings.tsx src/panels/settings/sections/MCPsSettings.tsx src/panels/settings/sections/RepositorySettings.tsx src/panels/settings/sections/TerminalPresets.tsx src/panels/settings/sections/*.test.tsx
git commit -m "refactor(settings): drop inline section h3, header now owned by SettingsHeader"
```

---

## Task 21: Coverage check + smoke

**Files:** none modified (unless coverage gaps surface).

- [ ] **Step 1: Run the full unit suite**

Run: `bun run test:coverage`
Expected: PASS. Lines 100, branches ≥ 95, functions 100, statements 100.

- [ ] **Step 2: If coverage falls short, add the missing assertions**

For any uncovered branch, add a focused test in the relevant `*.test.tsx`. Re-run coverage. Repeat until thresholds are met.

- [ ] **Step 3: Manual smoke in Tauri**

```bash
bun run tauri dev
```

Inside the running app, verify:
1. Press ⌘, — modal opens with glass effect and gradient hairline.
2. Type "git" in the nav search — only Git survives; the SYSTEM group header hides if your current section is in WORKSPACE/AI/EDITOR.
3. Click through every section — each one shows the new title + helper text + groups.
4. Toggle a switch — see the animated gradient track.
5. Close the modal with Escape.
6. Re-open the modal — it should land on the last viewed section (URL persistence).
7. Set system "Reduce Motion" — modal opens instantly, no fade.

- [ ] **Step 4: Commit coverage-only changes (if any)**

```bash
git add src/panels/settings/**/*.test.tsx
git commit -m "test(settings): close remaining coverage gaps"
```

---

## Task 22: Update CLAUDE.md / SYSTEM-DESIGN snapshot

**Files:**
- Modify: `SYSTEM-DESIGN.md` — note the new `useSettings` store + Settings primitives under the Frontend section. One bullet only.

- [ ] **Step 1: Locate the Frontend / state section**

Find the heading that documents Zustand stores. Add this line:

> - `src/lib/stores/settings.ts` — `useSettings(key, default)` hook backed by a typed `SettingsKey` enum; debounced 250 ms persist via `settings_write`.

If the file has no such section, skip this task.

- [ ] **Step 2: Commit**

```bash
git add SYSTEM-DESIGN.md
git commit -m "docs(system-design): note useSettings store"
```

---

## Self-Review Checklist (run before declaring complete)

- [ ] Every spec section maps to a task above:
  - Architecture / file layout → Tasks 4–13
  - Visual language → Tasks 1, 2, 5–13 (token + components carry the styles)
  - Data flow → Task 4 (`useSettings`)
  - IPC contracts → Task 3
  - Nav structure → Task 12
  - Testing strategy → tests in each TDD task + coverage gate Task 21
  - Build order in the spec → matches Task 1 → 22 sequence
  - Risks (in-memory persistence, backdrop-filter fallback) → in-memory is footer-status-driven (Task 11), backdrop fallback inherits Tailwind's `backdrop-blur` which already degrades gracefully

- [ ] No placeholders, TODOs, or vague steps in any task.
- [ ] Type names match across tasks: `SettingsKey`, `SettingsValue`, `SectionId`, `NavGroup`.
- [ ] Every file path is absolute or relative-to-repo-root and consistent.
- [ ] No task depends on a function or test-id introduced in a later task.
