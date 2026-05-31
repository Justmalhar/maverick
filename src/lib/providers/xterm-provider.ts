// xterm.js v5 implementation of TerminalProvider (default renderer).
// Consumers go through TerminalRegistry — never import xterm.js directly.
//
// The production path is acquireLeaf → the bounded renderer pool; the heavy
// xterm/addon imports + css live in renderer-pool.ts. mount() exists only to
// satisfy the TerminalProvider interface and is never reached in production
// (TerminalPane uses acquireLeaf whenever it is present), so it is intentionally
// unimplemented rather than duplicating the pool's xterm imports (CLAUDE.md
// rule 8 — bundle budget).
import type { ITheme } from "@xterm/xterm";
import type {
  TerminalProvider,
  TerminalHandle,
  TerminalOptions,
  PooledTerminalHandle,
  PtyBridge,
} from "../terminal-provider";
import type { TerminalTheme } from "../ipc";
import {
  setPoolConfig,
  poolConfigured,
} from "./renderer-pool";
import {
  ensureSession,
  bind,
  releaseSession,
  feedSession,
  focusSession,
  setSessionTheme,
  onSessionResize,
  sessionBound,
  disposeSession,
} from "./terminal-session";

export function toXtermTheme(t: TerminalTheme): ITheme {
  return {
    background: t.background,
    foreground: t.foreground,
    cursor: t.cursor,
    black: t.black,
    red: t.red,
    green: t.green,
    yellow: t.yellow,
    blue: t.blue,
    magenta: t.magenta,
    cyan: t.cyan,
    white: t.white,
    brightBlack: t.brightBlack,
    brightRed: t.brightRed,
    brightGreen: t.brightGreen,
    brightYellow: t.brightYellow,
    brightBlue: t.brightBlue,
    brightMagenta: t.brightMagenta,
    brightCyan: t.brightCyan,
    brightWhite: t.brightWhite,
  };
}

export class XtermProvider implements TerminalProvider {
  // Required by the TerminalProvider interface but unreachable in production:
  // TerminalPane always takes the acquireLeaf (pooled) path when it is present.
  // Implementing it would re-import the heavy xterm core/addons that
  // renderer-pool.ts already owns, breaking the bundle budget (CLAUDE.md rule 8).
  mount(_container: HTMLElement, _options: TerminalOptions): TerminalHandle {
    void _container;
    void _options;
    throw new Error(
      "XtermProvider.mount is not implemented; use acquireLeaf (pooled renderer)."
    );
  }

  acquireLeaf(
    leafId: string,
    options: TerminalOptions,
    bridge: PtyBridge
  ): PooledTerminalHandle {
    if (!poolConfigured()) {
      setPoolConfig({
        theme: toXtermTheme(options.theme),
        fontSize: options.fontSize,
        fontFamily: options.fontFamily,
        lineHeight: options.lineHeight ?? 1.2,
        scrollback: options.scrollback,
      });
    }
    const session = ensureSession(leafId, bridge, toXtermTheme(options.theme));
    void session;

    return {
      acquire(container) {
        const s = ensureSession(leafId, bridge, toXtermTheme(options.theme));
        bind(s, container);
      },
      release() {
        releaseSession(leafId);
      },
      feed(data) {
        feedSession(leafId, data);
      },
      onData() {
        // Pooled slots forward keystrokes straight to the PTY through the
        // bridge (see renderer-pool's term.onData). The session needs no
        // per-handle data subscription, so this is a no-op disposer.
        return () => {};
      },
      onResize(callback) {
        return onSessionResize(leafId, callback);
      },
      setTheme(theme) {
        setSessionTheme(leafId, toXtermTheme(theme));
      },
      focus() {
        focusSession(leafId);
      },
      dispose() {
        disposeSession(leafId);
      },
      get bound() {
        return sessionBound(leafId);
      },
    };
  }
}
