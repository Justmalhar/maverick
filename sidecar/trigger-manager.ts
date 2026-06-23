import type { Automation } from "./types";

// Activates a project's `schedule` + `on-file-change` automations for the
// lifetime of an OPEN workspace, scoped to that workspace's worktree. Handles
// are keyed by workspaceId and torn down on deactivate, so nothing leaks past a
// workspace close and nothing fires while the app/workspace is closed.

/** Parse a simple interval ("30m" / "2h" / "1d") to milliseconds, or null. */
export function parseInterval(spec: string): number | null {
  const m = /^(\d+)(m|h|d)$/.exec(spec.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (n <= 0) return null;
  const unit = m[2];
  const ms = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * ms;
}

const DEBOUNCE_MS = 500;

type Timer = ReturnType<typeof setInterval>;

export interface ActivateParams {
  workspaceId: string;
  projectPath: string;
  worktreePath: string;
}

export interface TriggerDeps {
  /** Read the project's automations (throws → treated as "none"). */
  loadAutomations: (projectPath: string) => Automation[];
  /** Run one automation in the worktree. */
  runAutomation: (params: {
    projectPath: string;
    automationName: string;
    worktreePath: string;
  }) => Promise<unknown>;
  /** Watch a worktree for changes; returns an unwatch fn. */
  watch: (worktreePath: string, onChange: () => void) => () => void;
  // Timers are injectable so tests drive them without real time.
  setInterval?: (fn: () => void, ms: number) => Timer;
  clearInterval?: (t: Timer) => void;
  setTimeout?: (fn: () => void, ms: number) => Timer;
  clearTimeout?: (t: Timer) => void;
  log?: (msg: string) => void;
}

interface ActiveHandles {
  intervals: Timer[];
  cleanups: Array<() => void>;
}

export class TriggerManager {
  private deps: Required<Pick<TriggerDeps, "loadAutomations" | "runAutomation" | "watch">> &
    TriggerDeps;
  private setIntervalFn: (fn: () => void, ms: number) => Timer;
  private clearIntervalFn: (t: Timer) => void;
  private setTimeoutFn: (fn: () => void, ms: number) => Timer;
  private clearTimeoutFn: (t: Timer) => void;
  private log: (msg: string) => void;

  private active = new Map<string, ActiveHandles>();
  private inFlight = new Set<string>();

  constructor(deps: TriggerDeps) {
    this.deps = deps;
    this.setIntervalFn = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalFn = deps.clearInterval ?? ((t) => clearInterval(t));
    this.setTimeoutFn = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = deps.clearTimeout ?? ((t) => clearTimeout(t));
    this.log = deps.log ?? (() => {});
  }

  /** Activate triggers for a workspace. Idempotent: replaces prior handles. */
  activate(params: ActivateParams): void {
    const { workspaceId, projectPath, worktreePath } = params;
    this.deactivate(workspaceId);

    let automations: Automation[];
    try {
      automations = this.deps.loadAutomations(projectPath);
    } catch {
      automations = []; // no/unreadable config → nothing to activate
    }

    const handles: ActiveHandles = { intervals: [], cleanups: [] };
    for (const a of automations) {
      if (a.trigger === "schedule") {
        const ms = a.interval ? parseInterval(a.interval) : null;
        if (ms === null) {
          this.log(`trigger: skipping schedule '${a.name}' — invalid interval '${a.interval ?? ""}'`);
          continue;
        }
        const t = this.setIntervalFn(() => {
          void this.fire(workspaceId, projectPath, worktreePath, a.name);
        }, ms);
        handles.intervals.push(t);
      } else if (a.trigger === "on-file-change") {
        let debounce: Timer | null = null;
        const unwatch = this.deps.watch(worktreePath, () => {
          if (debounce) this.clearTimeoutFn(debounce);
          debounce = this.setTimeoutFn(() => {
            void this.fire(workspaceId, projectPath, worktreePath, a.name);
          }, DEBOUNCE_MS);
        });
        handles.cleanups.push(() => {
          if (debounce) this.clearTimeoutFn(debounce);
          try {
            unwatch();
          } catch {
            /* watch may already be gone */
          }
        });
      }
      // manual: ignored — run on demand via automation.run.
    }
    this.active.set(workspaceId, handles);
  }

  /** Tear down a workspace's triggers (timers, watchers, pending debounces). */
  deactivate(workspaceId: string): void {
    const h = this.active.get(workspaceId);
    if (!h) return;
    h.intervals.forEach((t) => this.clearIntervalFn(t));
    h.cleanups.forEach((c) => c());
    this.active.delete(workspaceId);
  }

  /** Tear down everything (sidecar shutdown). */
  deactivateAll(): void {
    for (const id of [...this.active.keys()]) this.deactivate(id);
  }

  private async fire(
    workspaceId: string,
    projectPath: string,
    worktreePath: string,
    automationName: string,
  ): Promise<void> {
    const key = `${workspaceId}::${automationName}`;
    if (this.inFlight.has(key)) return; // overlap guard: skip while a run is in flight
    this.inFlight.add(key);
    try {
      await this.deps.runAutomation({ projectPath, automationName, worktreePath });
    } catch (e) {
      this.log(`trigger: automation '${automationName}' failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.inFlight.delete(key);
    }
  }
}
