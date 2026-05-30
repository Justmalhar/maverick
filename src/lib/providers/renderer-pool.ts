// Bounded xterm.js renderer pool. RSS scales with POOL_MAX_SIZE (~6), not the
// number of open terminals: 10+ leaves share a handful of live xterm instances.
// A leaf that scrolls out of the live window RELEASES its slot — its scrollback
// is serialized to a snapshot string and the DOM/WebGL slot is recycled for the
// next leaf. The PTY/session is untouched; only the expensive renderer moves.
//
// Consumers reach this ONLY through XtermProvider / TerminalRegistry — xterm is
// never imported outside src/lib/providers (CLAUDE.md rule 4).
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import type { ITheme } from "@xterm/xterm";

export const POOL_MAX_SIZE = 6;
// Two-stage resize debounce: FitAddon.fit is cheap+local (~8ms), the PTY resize
// ioctl is the expensive cross-process hop (~256ms, and only when dims change).
// Single source of truth — any other renderer path must import these, not
// redeclare them.
export const FIT_DEBOUNCE_MS = 8;
export const PTY_RESIZE_DEBOUNCE_MS = 256;
const SNAPSHOT_SCROLLBACK_CAP = 5_000;
// Below this a re-shown slot is fresh enough to trust; above it, repaint on
// unhide to defeat silent GPU/context staleness.
const SLOT_STALE_MS = 10_000;

export interface TermConfig {
  theme: ITheme;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  scrollback: number;
}

// Per-leaf bridge back to the PTY. Lets the pool forward keystrokes/resizes
// without knowing about Tauri or the session layer.
export interface LeafBridge {
  writeToPty(data: string): void;
  resizePty(cols: number, rows: number): void;
  // Force a SIGWINCH by bumping rows +1 then restoring — the kernel suppresses
  // winsize ioctls that don't change dims. Used to make a dormant alt-screen
  // TUI repaint from scratch on re-acquire.
  kickPty(cols: number, rows: number): void;
}

export interface SlotAdapter {
  resolveLeaf(leafId: string): LeafBridge | null;
  // The slot that previously held `leafId` is being reclaimed for another leaf.
  evictLeaf(leafId: string): void;
  isLeafFocused(leafId: string): boolean;
}

// Optional WebGL acceleration. Maverick ships the canvas renderer by default
// (no @xterm/addon-webgl dependency), so this stays null and the slot uses the
// DOM/canvas renderer. Tests inject a factory to exercise context-loss recovery.
export interface WebglLike {
  dispose(): void;
  onContextLoss(cb: () => void): void;
}
export type WebglFactory = () => WebglLike;
let webglFactory: WebglFactory | null = null;
export function setWebglFactory(factory: WebglFactory | null): void {
  webglFactory = factory;
}

export interface Slot {
  readonly id: number;
  readonly term: Terminal;
  readonly fitAddon: FitAddon;
  readonly searchAddon: SearchAddon;
  readonly serializeAddon: SerializeAddon;
  readonly host: HTMLDivElement;
  webgl: WebglLike | null;
  currentLeafId: string | null;
  resizeListeners: Set<(cols: number, rows: number) => void>;
  dataDisposer: (() => void) | null;
  observer: ResizeObserver | null;
  fitTimer: ReturnType<typeof setTimeout> | null;
  ptyTimer: ReturnType<typeof setTimeout> | null;
  unhideRaf: number | null;
  lastCols: number;
  lastRows: number;
  lastW: number;
  lastH: number;
  lastUsedAt: number;
}

const slots: Slot[] = [];
let recyclerEl: HTMLDivElement | null = null;
let adapter: SlotAdapter | null = null;
let config: TermConfig | null = null;

export function configureRendererPool(a: SlotAdapter): void {
  adapter = a;
}

export function poolSize(): number {
  return slots.length;
}

// clearTimeout(null) is a documented no-op, so an unconditional clear keeps the
// guard logic in one place instead of `if (x) clearTimeout(x)` at every site.
function clearSlotTimers(s: Slot): void {
  clearTimeout(s.fitTimer ?? undefined);
  clearTimeout(s.ptyTimer ?? undefined);
  s.fitTimer = null;
  s.ptyTimer = null;
}

export function __resetPoolForTests(): void {
  for (const s of slots) {
    cancelPendingUnhide(s);
    s.observer?.disconnect();
    clearSlotTimers(s);
    s.dataDisposer?.();
    try {
      s.webgl?.dispose();
    } catch {
      // best-effort teardown
    }
    try {
      s.term.dispose();
    } catch {
      // best-effort teardown
    }
  }
  slots.length = 0;
  adapter = null;
  config = null;
  webglFactory = null;
  if (recyclerEl?.parentNode) recyclerEl.parentNode.removeChild(recyclerEl);
  recyclerEl = null;
}

function getRecycler(): HTMLDivElement {
  if (recyclerEl && recyclerEl.isConnected) return recyclerEl;
  const el = document.createElement("div");
  el.setAttribute("data-mv-recycler", "");
  // Offscreen, contained, non-interactive: a released slot lives here so its
  // GPU/DOM state survives without painting or capturing input.
  el.style.cssText =
    "position:fixed;left:-99999px;top:-99999px;width:1024px;height:768px;overflow:hidden;pointer-events:none;contain:strict;";
  document.body.appendChild(el);
  recyclerEl = el;
  return el;
}

function attachWebgl(slot: Slot): void {
  if (slot.webgl || !webglFactory) return;
  try {
    const webgl = webglFactory();
    webgl.onContextLoss(() => {
      if (slot.webgl === webgl) slot.webgl = null;
      try {
        webgl.dispose();
      } catch {
        // already gone
      }
      // WebKit can transiently lose GPU contexts on sleep/wake; without a
      // re-attach the slot would silently fall back to DOM forever.
      setTimeout(() => {
        if (!slot.webgl) {
          attachWebgl(slot);
          if (slot.webgl) {
            try {
              slot.term.refresh(0, slot.term.rows - 1);
            } catch {
              // refresh racing dispose
            }
          }
        }
      }, 250);
    });
    slot.term.loadAddon(webgl as never);
    slot.webgl = webgl;
  } catch {
    // WebGL unavailable — canvas renderer remains.
  }
}

function createSlot(): Slot {
  const cfg = config!;
  const term = new Terminal({
    fontFamily: cfg.fontFamily,
    fontSize: cfg.fontSize,
    lineHeight: cfg.lineHeight,
    scrollback: cfg.scrollback,
    cursorBlink: true,
    cursorStyle: "block",
    allowProposedApi: true,
    theme: cfg.theme,
  });
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const serializeAddon = new SerializeAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(serializeAddon);
  term.loadAddon(new WebLinksAddon());

  const host = document.createElement("div");
  host.style.cssText = "width:100%;height:100%;";
  host.setAttribute("data-mv-slot", String(slots.length));
  getRecycler().appendChild(host);
  term.open(host);

  const slot: Slot = {
    id: slots.length,
    term,
    fitAddon,
    searchAddon,
    serializeAddon,
    host,
    webgl: null,
    currentLeafId: null,
    resizeListeners: new Set(),
    dataDisposer: null,
    observer: null,
    fitTimer: null,
    ptyTimer: null,
    unhideRaf: null,
    lastCols: term.cols,
    lastRows: term.rows,
    lastW: 0,
    lastH: 0,
    lastUsedAt: 0,
  };

  attachWebgl(slot);

  // Keystrokes/paste are forwarded to whichever leaf currently owns the slot.
  const sub = term.onData((data) => {
    const leafId = slot.currentLeafId;
    if (leafId === null) return;
    adapter?.resolveLeaf(leafId)?.writeToPty(data);
  });
  slot.dataDisposer = () => sub.dispose();

  slots.push(slot);
  return slot;
}

function isAltScreen(s: Slot): boolean {
  try {
    return s.term.buffer.active.type === "alternate";
  } catch {
    return false;
  }
}

function isLeafFocused(s: Slot): boolean {
  return s.currentLeafId !== null && !!adapter?.isLeafFocused(s.currentLeafId);
}

interface PickResult {
  slot: Slot;
  previousLeafId: string | null;
}

// Eviction scoring: an alt-screen TUI is most expensive to lose (it can't be
// replayed coherently), then a focused leaf, then least-recently-used. The
// lowest score is evicted.
function pickSlotFor(): PickResult {
  const free = slots.find((s) => s.currentLeafId === null);
  if (free) return { slot: free, previousLeafId: null };
  if (slots.length < POOL_MAX_SIZE)
    return { slot: createSlot(), previousLeafId: null };

  // The pool is full and every slot is bound (acquireSlot already short-circuits
  // a leaf that owns a slot). Score each and evict the lowest.
  let best = slots[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const s of slots) {
    const focused = isLeafFocused(s);
    const score =
      (isAltScreen(s) ? 100 : 0) + (focused ? 10 : 0) + s.lastUsedAt / 1e12;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return { slot: best, previousLeafId: best.currentLeafId };
}

export interface AcquireParams {
  leafId: string;
  container: HTMLElement;
  snapshot: string | null;
  // The released slot was in alt-screen mode (vim, htop, …). Replaying a byte
  // ring on top of a stale snapshot corrupts a TUI, so the ring is discarded
  // and the PTY is SIGWINCH-kicked to repaint instead.
  altScreen: boolean;
  drainRing: (write: (data: string) => void) => void;
  cols: number;
  rows: number;
}

export function acquireSlot(p: AcquireParams): Slot {
  const existing = slots.find((s) => s.currentLeafId === p.leafId);
  if (existing) {
    rewireSlot(existing, p);
    return existing;
  }
  const pick = pickSlotFor();
  if (pick.previousLeafId !== null) {
    adapter?.evictLeaf(pick.previousLeafId);
  }
  if (pick.slot.currentLeafId !== null && pick.slot.currentLeafId !== p.leafId) {
    detachSlotFromLeaf(pick.slot);
  }
  bindSlot(pick.slot, p);
  return pick.slot;
}

function bindSlot(slot: Slot, p: AcquireParams): void {
  const stale = performance.now() - slot.lastUsedAt > SLOT_STALE_MS;
  slot.currentLeafId = p.leafId;
  slot.lastUsedAt = performance.now();

  cancelPendingUnhide(slot);
  slot.host.style.visibility = "hidden";

  if (slot.host.parentNode !== p.container) {
    p.container.appendChild(slot.host);
  }

  slot.term.clear();
  slot.term.reset();

  if (
    p.cols > 0 &&
    p.rows > 0 &&
    (slot.term.cols !== p.cols || slot.term.rows !== p.rows)
  ) {
    slot.term.resize(p.cols, p.rows);
  }

  if (p.snapshot) {
    try {
      slot.term.write(p.snapshot);
    } catch {
      // serialized snapshot may contain a sequence the parser rejects
    }
  }
  if (p.altScreen) {
    // Discard the ring; the SIGWINCH kick below repaints the TUI from scratch.
    p.drainRing(() => {});
  } else {
    p.drainRing((data) => slot.term.write(data));
  }
  // Re-show the cursor in case a dormant program hid it.
  try {
    slot.term.write("\x1b[?25h");
  } catch {
    // ignore
  }

  setupResizeObserver(slot, p);
  safeFit(slot);
  slot.lastCols = slot.term.cols;
  slot.lastRows = slot.term.rows;
  slot.lastW = p.container.clientWidth;
  slot.lastH = p.container.clientHeight;
  if (slot.lastCols !== p.cols || slot.lastRows !== p.rows) {
    adapter?.resolveLeaf(p.leafId)?.resizePty(slot.lastCols, slot.lastRows);
  }

  if (p.altScreen) {
    adapter?.resolveLeaf(p.leafId)?.kickPty(slot.term.cols, slot.term.rows);
  }

  scheduleUnhide(slot, stale);
}

function rewireSlot(slot: Slot, p: AcquireParams): void {
  slot.lastUsedAt = performance.now();
  if (slot.host.parentNode !== p.container) {
    p.container.appendChild(slot.host);
  }
  setupResizeObserver(slot, p);
  safeFit(slot);
  slot.lastW = p.container.clientWidth;
  slot.lastH = p.container.clientHeight;
  if (slot.term.cols !== p.cols || slot.term.rows !== p.rows) {
    adapter?.resolveLeaf(p.leafId)?.resizePty(slot.term.cols, slot.term.rows);
  }
  slot.lastCols = slot.term.cols;
  slot.lastRows = slot.term.rows;
}

// Double-RAF unhide: the slot is moved + written while hidden, then revealed a
// frame later so the user never sees a half-painted reflow. A stale slot also
// gets a forced repaint to defeat silent GPU/context staleness.
function scheduleUnhide(slot: Slot, stale: boolean): void {
  slot.unhideRaf = requestAnimationFrame(() => {
    slot.unhideRaf = requestAnimationFrame(() => {
      slot.unhideRaf = null;
      slot.host.style.visibility = "";
      if (stale) {
        if (!slot.webgl) attachWebgl(slot);
        try {
          slot.term.refresh(0, slot.term.rows - 1);
        } catch {
          // refresh racing teardown
        }
      }
      const leafId = slot.currentLeafId;
      if (leafId !== null && adapter?.isLeafFocused(leafId)) {
        slot.term.focus();
      }
    });
  });
}

function cancelPendingUnhide(slot: Slot): void {
  if (slot.unhideRaf !== null) {
    cancelAnimationFrame(slot.unhideRaf);
    slot.unhideRaf = null;
  }
}

function safeFit(slot: Slot): void {
  try {
    slot.fitAddon.fit();
  } catch {
    // container may not be sized yet; ResizeObserver refits
  }
  notifyResize(slot);
}

function notifyResize(slot: Slot): void {
  for (const cb of slot.resizeListeners) cb(slot.term.cols, slot.term.rows);
}

// Two-stage resize: FitAddon.fit at ~8ms (cheap, local) reflows the grid, then
// the PTY resize ioctl fires at ~256ms and ONLY if cols/rows actually changed —
// the ioctl is the expensive cross-process hop. Both stages are guarded against
// a 0x0 / display:none element so a hidden slot is never resized to a 1x1 grid.
function setupResizeObserver(slot: Slot, p: AcquireParams): void {
  slot.observer?.disconnect();
  clearSlotTimers(slot);

  const container = p.container;
  const flushPty = () => {
    slot.ptyTimer = null;
    if (slot.currentLeafId !== p.leafId) return;
    if (slot.term.cols === slot.lastCols && slot.term.rows === slot.lastRows)
      return;
    slot.lastCols = slot.term.cols;
    slot.lastRows = slot.term.rows;
    adapter?.resolveLeaf(p.leafId)?.resizePty(slot.lastCols, slot.lastRows);
    notifyResize(slot);
  };

  slot.observer = new ResizeObserver(() => {
    if (slot.fitTimer) clearTimeout(slot.fitTimer);
    slot.fitTimer = setTimeout(() => {
      slot.fitTimer = null;
      if (slot.currentLeafId !== p.leafId) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      // Guard against display:none / 0x0: never resize the grid to 1x1.
      if (w === 0 || h === 0) return;
      if (w === slot.lastW && h === slot.lastH) return;
      slot.lastW = w;
      slot.lastH = h;
      try {
        slot.fitAddon.fit();
      } catch {
        // not sized yet
      }
      if (slot.ptyTimer) clearTimeout(slot.ptyTimer);
      slot.ptyTimer = setTimeout(flushPty, PTY_RESIZE_DEBOUNCE_MS);
    }, FIT_DEBOUNCE_MS);
  });
  slot.observer.observe(container);
}

export interface SerializeOutput {
  snapshot: string | null;
  cols: number;
  rows: number;
  altScreen: boolean;
}

export function releaseSlot(leafId: string): SerializeOutput | null {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return null;
  const out = serializeSlot(slot);
  detachSlotFromLeaf(slot);
  return out;
}

function serializeSlot(slot: Slot): SerializeOutput {
  let snapshot: string | null = null;
  try {
    snapshot = slot.serializeAddon.serialize({
      scrollback: SNAPSHOT_SCROLLBACK_CAP,
    });
  } catch {
    // serialize can throw on a torn-down terminal
  }
  return {
    snapshot,
    cols: slot.term.cols,
    rows: slot.term.rows,
    altScreen: isAltScreen(slot),
  };
}

function detachSlotFromLeaf(slot: Slot): void {
  slot.observer?.disconnect();
  slot.observer = null;
  clearSlotTimers(slot);
  slot.resizeListeners.clear();

  cancelPendingUnhide(slot);
  slot.host.style.visibility = "";

  if (slot.host.parentNode !== getRecycler()) {
    getRecycler().appendChild(slot.host);
  }

  // Don't touch lastUsedAt here: a freed slot must keep its real last-used time
  // so a future eviction's LRU score reflects when it was actually in use, not
  // when it was detached. Only bindSlot stamps lastUsedAt.
  slot.currentLeafId = null;
}

export function getSlotForLeaf(leafId: string): Slot | null {
  return slots.find((s) => s.currentLeafId === leafId) ?? null;
}

export function writeToSlot(leafId: string, data: string | Uint8Array): boolean {
  const slot = getSlotForLeaf(leafId);
  if (!slot) return false;
  slot.term.write(data as string);
  return true;
}

export function focusSlot(leafId: string): void {
  getSlotForLeaf(leafId)?.term.focus();
}

export function addResizeListener(
  leafId: string,
  cb: (cols: number, rows: number) => void
): () => void {
  const slot = getSlotForLeaf(leafId);
  if (!slot) return () => {};
  slot.resizeListeners.add(cb);
  cb(slot.term.cols, slot.term.rows);
  return () => slot.resizeListeners.delete(cb);
}

export function resizeSlot(leafId: string, cols: number, rows: number): void {
  const slot = getSlotForLeaf(leafId);
  if (!slot || cols <= 0 || rows <= 0) return;
  slot.term.resize(cols, rows);
}

export function setSlotTheme(leafId: string, theme: ITheme): void {
  const slot = getSlotForLeaf(leafId);
  if (slot) slot.term.options.theme = theme;
}

export function applyTheme(theme: ITheme): void {
  for (const slot of slots) slot.term.options.theme = theme;
}

export function setPoolConfig(cfg: TermConfig): void {
  config = cfg;
}

export function poolConfigured(): boolean {
  return config !== null;
}
