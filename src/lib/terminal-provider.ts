import type { TerminalTheme } from "./ipc";

export interface TerminalOptions {
  theme: TerminalTheme;
  fontSize: number;
  fontFamily: string;
  ligatures: boolean;
  scrollback: number;
  /** Cell-height multiplier. ~1.2 reads like a native terminal; 1.0 feels cramped. */
  lineHeight?: number;
}

export interface TerminalHandle {
  write(data: string | Uint8Array): void;
  /** Subscribe to user keystrokes/paste from the terminal. Returns an unsubscribe fn. */
  onData(callback: (data: string) => void): () => void;
  /**
   * Subscribe to the renderer's fitted grid size (fires after the terminal
   * fits its container). Consumers must keep the backing PTY at these exact
   * cols/rows or the program's TUI will render misaligned. Returns unsubscribe.
   */
  onResize(callback: (cols: number, rows: number) => void): () => void;
  resize(cols: number, rows: number): void;
  setTheme(theme: TerminalTheme): void;
  focus(): void;
  dispose(): void;
  readonly dimensions: { cols: number; rows: number };
}

/**
 * Per-leaf bridge the pooled renderer uses to push user keystrokes/resizes back
 * to the owning PTY. Lives in the consumer layer so the renderer pool stays
 * decoupled from Tauri. A leaf RELEASES its renderer slot when it scrolls out
 * of the live window; the bridge keeps the PTY/session alive across that.
 */
export interface PtyBridge {
  writeToPty(data: string): void;
  resizePty(cols: number, rows: number): void;
  /** Force a SIGWINCH so a dormant alt-screen TUI repaints from scratch. */
  kickPty(cols: number, rows: number): void;
}

/**
 * A renderer bound to a leaf via the bounded pool. Unlike a `mount`ed handle it
 * can be released (slot recycled, scrollback serialized) and later re-acquired
 * without losing output (dormant ring replay). PTY bytes are delivered through
 * `feed` which routes to the slot if bound, else the leaf's dormant ring.
 */
export interface PooledTerminalHandle {
  /** Bind/move this leaf onto a pool slot in the given container (idempotent). */
  acquire(container: HTMLElement): void;
  /** Serialize + recycle the slot, keeping the session/PTY ring alive. */
  release(): void;
  /** Route a PTY byte chunk to the bound slot, else buffer in the dormant ring. */
  feed(data: string): void;
  onData(callback: (data: string) => void): () => void;
  onResize(callback: (cols: number, rows: number) => void): () => void;
  setTheme(theme: TerminalTheme): void;
  focus(): void;
  /** Tear down the session entirely (leaf closed): slot released, ring cleared. */
  dispose(): void;
  readonly bound: boolean;
}

export interface TerminalProvider {
  mount(container: HTMLElement, options: TerminalOptions): TerminalHandle;
  /**
   * Optional pooled path. Providers that support a bounded renderer pool return
   * a per-leaf handle keyed by `leafId`; absence means the provider is
   * mount-only (e.g. a test stub) and callers fall back to `mount`.
   */
  acquireLeaf?(
    leafId: string,
    options: TerminalOptions,
    bridge: PtyBridge
  ): PooledTerminalHandle;
}

// Singleton registry — one provider active at a time
let _provider: TerminalProvider | null = null;

export const TerminalRegistry = {
  register(provider: TerminalProvider) {
    _provider = provider;
  },
  get(): TerminalProvider {
    if (!_provider) throw new Error("No TerminalProvider registered");
    return _provider;
  },
};
