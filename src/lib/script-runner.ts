// Keep-alive registry for Setup/Run scripts. The live PTY, its output buffer,
// and run state live here — OUTSIDE the React component lifecycle — so they
// survive ScriptPane unmounts (bottom-panel collapse, tab switch, the
// AuxiliaryBar swapping <Panel/> ↔ <Panel collapsed/>). This mirrors the
// keep-alive contract that TerminalRegistry gives terminals (CLAUDE.md rule 6):
// a dev server started from the Run panel must NOT be orphaned just because the
// panel that launched it was unmounted, and its logs must still be there when
// the panel comes back.
import { ptySpawn, ptyKill, onPtyData, onPtyExit } from "@/lib/tauri";
import { shellCommandArgs } from "@/lib/terminal-shell";

export type ScriptState = "idle" | "running" | "exited";
export type ScriptKind = "setup" | "run";

export interface ScriptSnapshot {
  state: ScriptState;
  exitCode: number | null;
  startedAt: number | null;
  output: string;
}

const BUFFER_CAP = 256 * 1024;

const IDLE_SNAPSHOT: ScriptSnapshot = {
  state: "idle",
  exitCode: null,
  startedAt: null,
  output: "",
};

interface Runner {
  state: ScriptState;
  exitCode: number | null;
  startedAt: number | null;
  output: string;
  ptyId: string | null;
  listeners: Set<() => void>;
  snapshot: ScriptSnapshot;
}

const runners = new Map<string, Runner>();
// ptyId → runner key, so the shared PTY listeners can route events even while
// the owning ScriptPane is unmounted (no per-component listener filtering).
const ptyToKey = new Map<string, string>();

let listenersInstalled = false;

export function runnerKey(workspaceId: string, kind: ScriptKind): string {
  return `${workspaceId}:${kind}`;
}

function freshRunner(): Runner {
  return {
    state: "idle",
    exitCode: null,
    startedAt: null,
    output: "",
    ptyId: null,
    listeners: new Set(),
    snapshot: IDLE_SNAPSHOT,
  };
}

function getOrCreate(key: string): Runner {
  let r = runners.get(key);
  if (!r) {
    r = freshRunner();
    runners.set(key, r);
  }
  return r;
}

// Rebuild the immutable snapshot (stable reference between mutations, required
// by useSyncExternalStore) and notify subscribers.
function bump(r: Runner): void {
  r.snapshot = {
    state: r.state,
    exitCode: r.exitCode,
    startedAt: r.startedAt,
    output: r.output,
  };
  for (const cb of r.listeners) cb();
}

function ensureListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  void onPtyData(({ ptyId, data }) => {
    const key = ptyToKey.get(ptyId);
    if (!key) return;
    const r = runners.get(key);
    /* v8 ignore next 2 -- defensive: ptyToKey and runners are kept in sync */
    if (!r) return;
    const next = r.output + data;
    r.output = next.length > BUFFER_CAP ? next.slice(next.length - BUFFER_CAP) : next;
    bump(r);
  }).catch(() => {});
  void onPtyExit(({ ptyId, code }) => {
    const key = ptyToKey.get(ptyId);
    ptyToKey.delete(ptyId);
    if (!key) return;
    const r = runners.get(key);
    /* v8 ignore next 2 -- defensive: ptyToKey and runners are kept in sync */
    if (!r) return;
    if (r.ptyId !== ptyId) return;
    r.ptyId = null;
    r.exitCode = code;
    r.state = "exited";
    bump(r);
  }).catch(() => {});
}

export function subscribeRunner(key: string, cb: () => void): () => void {
  ensureListeners();
  const r = getOrCreate(key);
  r.listeners.add(cb);
  return () => {
    r.listeners.delete(cb);
  };
}

export function getRunnerSnapshot(key: string): ScriptSnapshot {
  return runners.get(key)?.snapshot ?? IDLE_SNAPSHOT;
}

export async function startRunner(
  key: string,
  script: string,
  cwd: string | null
): Promise<void> {
  if (!script.trim()) return;
  ensureListeners();
  const r = getOrCreate(key);
  // Already running for this workspace+kind: do NOT spawn a second process.
  // This is what kept orphaning the dev server and bumping :3000 → :3001.
  if (r.state === "running") return;
  r.output = "";
  r.exitCode = null;
  r.startedAt = Date.now();
  bump(r);
  const [shellCmd, ...shellArgs] = shellCommandArgs(script);
  const { ptyId } = await ptySpawn(shellCmd, shellArgs, cwd ?? undefined);
  r.ptyId = ptyId;
  ptyToKey.set(ptyId, key);
  r.state = "running";
  bump(r);
}

export async function stopRunner(key: string): Promise<void> {
  const r = runners.get(key);
  if (!r || !r.ptyId) return;
  const id = r.ptyId;
  // Clear the handle synchronously so a second stop() is a no-op and the
  // natural pty:exit for this id is ignored — a user-initiated stop returns to
  // idle (logs preserved), never the red "Exited" error state.
  r.ptyId = null;
  ptyToKey.delete(id);
  r.state = "idle";
  bump(r);
  try {
    await ptyKill(id);
    /* v8 ignore next 3 */
  } catch {
    // idempotent: kill may race with natural exit
  }
}

// Tear down both runners for a workspace when it closes. Kills any live PTY so
// a dev server isn't orphaned past the workspace's lifetime, and drops the
// entries so the registry doesn't grow unbounded across the session.
export function disposeWorkspaceRunners(workspaceId: string): void {
  for (const kind of ["setup", "run"] as ScriptKind[]) {
    const key = runnerKey(workspaceId, kind);
    const r = runners.get(key);
    if (!r) continue;
    if (r.ptyId) {
      const id = r.ptyId;
      ptyToKey.delete(id);
      void ptyKill(id).catch(() => {});
    }
    runners.delete(key);
  }
}

export function __resetRunnersForTests(): void {
  runners.clear();
  ptyToKey.clear();
  listenersInstalled = false;
}
