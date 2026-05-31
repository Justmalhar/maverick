// Per-leaf terminal sessions: the seam that decouples a leaf's PTY/output from
// its (transient) xterm renderer slot. While a leaf has a bound slot, PTY bytes
// are written straight to xterm; while it's dormant, bytes accumulate in its
// DormantRing. On re-acquire the serialized scrollback is replayed, then the
// ring is drained — no gap, no blank-on-refocus. The session (PTY, ring,
// snapshot) outlives any number of slot acquire/release cycles, which is how
// CLAUDE.md rule 6 (PTYs survive tab switches) is reconciled with the 200MB RSS
// budget: only the expensive renderer is recycled, never the session.
import { DormantRing } from "./dormant-ring";
import type { ITheme } from "@xterm/xterm";
import {
  acquireSlot,
  releaseSlot,
  getSlotForLeaf,
  focusSlot,
  addResizeListener,
  configureRendererPool,
  setSlotTheme,
  type LeafBridge,
} from "./renderer-pool";
import type { PtyBridge } from "../terminal-provider";

interface Session {
  leafId: string;
  bridge: PtyBridge;
  ring: DormantRing;
  snapshot: string | null;
  cols: number;
  rows: number;
  altScreenAtRelease: boolean;
  hasSlot: boolean;
  disposed: boolean;
  resizeListeners: Set<(cols: number, rows: number) => void>;
  resizeDisposer: (() => void) | null;
  theme: ITheme;
}

const sessions = new Map<string, Session>();

// Leaves the user is actively viewing. The pool's eviction scorer adds a focus
// bonus so a focused terminal is never recycled out from under the user under
// pool pressure. TerminalPane drives this from its isFocused effect.
const focusedLeaves = new Set<string>();

export function setLeafFocused(leafId: string, focused: boolean): void {
  if (focused) focusedLeaves.add(leafId);
  else focusedLeaves.delete(leafId);
}

// Single adapter for the whole pool — resolves a leaf id back to its session.
function installAdapter(): void {
  configureRendererPool({
    resolveLeaf(leafId): LeafBridge | null {
      const s = sessions.get(leafId);
      if (!s) return null;
      return {
        writeToPty: (data) => s.bridge.writeToPty(data),
        resizePty: (cols, rows) => {
          s.cols = cols;
          s.rows = rows;
          s.bridge.resizePty(cols, rows);
        },
        kickPty: (cols, rows) => s.bridge.kickPty(cols, rows),
      };
    },
    evictLeaf(leafId) {
      const s = sessions.get(leafId);
      if (s) unbind(s);
    },
    isLeafFocused(leafId) {
      return focusedLeaves.has(leafId);
    },
  });
}
installAdapter();

export function ensureSession(
  leafId: string,
  bridge: PtyBridge,
  theme: ITheme
): Session {
  const existing = sessions.get(leafId);
  if (existing) {
    existing.bridge = bridge;
    existing.theme = theme;
    return existing;
  }
  const session: Session = {
    leafId,
    bridge,
    ring: new DormantRing(),
    snapshot: null,
    cols: 0,
    rows: 0,
    altScreenAtRelease: false,
    hasSlot: false,
    disposed: false,
    resizeListeners: new Set(),
    resizeDisposer: null,
    theme,
  };
  sessions.set(leafId, session);
  return session;
}

export function feedSession(leafId: string, data: string): void {
  const s = sessions.get(leafId);
  if (!s) return;
  const slot = getSlotForLeaf(leafId);
  if (slot) slot.term.write(data);
  else s.ring.push(data);
}

export function bind(s: Session, container: HTMLElement): void {
  if (s.disposed) return;
  const altScreen = s.altScreenAtRelease;
  s.altScreenAtRelease = false;
  acquireSlot({
    leafId: s.leafId,
    container,
    snapshot: s.snapshot,
    altScreen,
    drainRing: (write) => s.ring.drain(write),
    cols: s.cols,
    rows: s.rows,
  });
  s.snapshot = null;
  s.hasSlot = true;
  setSlotTheme(s.leafId, s.theme);
  // Bridge the slot's fitted-size notifications to this session's subscribers.
  s.resizeDisposer?.();
  s.resizeDisposer = addResizeListener(s.leafId, (cols, rows) => {
    s.cols = cols;
    s.rows = rows;
    for (const cb of s.resizeListeners) cb(cols, rows);
  });
}

function unbind(s: Session): void {
  if (!s.hasSlot) return;
  s.resizeDisposer?.();
  s.resizeDisposer = null;
  const out = releaseSlot(s.leafId);
  if (out) {
    s.snapshot = out.snapshot;
    if (out.cols > 0) s.cols = out.cols;
    if (out.rows > 0) s.rows = out.rows;
    s.altScreenAtRelease = out.altScreen;
  }
  s.hasSlot = false;
}

export function releaseSession(leafId: string): void {
  const s = sessions.get(leafId);
  if (s) unbind(s);
}

export function disposeSession(leafId: string): void {
  const s = sessions.get(leafId);
  if (!s) return;
  s.disposed = true;
  unbind(s);
  s.ring.clear();
  s.snapshot = null;
  s.resizeListeners.clear();
  focusedLeaves.delete(leafId);
  sessions.delete(leafId);
}

export function focusSession(leafId: string): void {
  focusSlot(leafId);
}

export function setSessionTheme(leafId: string, theme: ITheme): void {
  const s = sessions.get(leafId);
  if (!s) return;
  s.theme = theme;
  setSlotTheme(leafId, theme);
}

export function onSessionResize(
  leafId: string,
  cb: (cols: number, rows: number) => void
): () => void {
  const s = sessions.get(leafId);
  if (!s) return () => {};
  s.resizeListeners.add(cb);
  // Emit the current size immediately so a late subscriber syncs at once.
  cb(s.cols, s.rows);
  return () => s.resizeListeners.delete(cb);
}

export function sessionBound(leafId: string): boolean {
  return sessions.get(leafId)?.hasSlot ?? false;
}

export function __resetSessionsForTests(): void {
  for (const s of sessions.values()) {
    s.resizeDisposer?.();
    s.resizeListeners.clear();
  }
  sessions.clear();
  focusedLeaves.clear();
  // __resetPoolForTests nulls the pool adapter; re-install ours so the next
  // test's bind() still resolves leaf bridges.
  installAdapter();
}
