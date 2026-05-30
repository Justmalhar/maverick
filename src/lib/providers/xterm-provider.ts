// xterm.js v5 implementation of TerminalProvider (default renderer).
// Consumers go through TerminalRegistry — never import xterm.js directly.
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import type {
  TerminalProvider,
  TerminalHandle,
  TerminalOptions,
} from "../terminal-provider";
import type { TerminalTheme } from "../ipc";

function toXtermTheme(t: TerminalTheme): ITheme {
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
  mount(container: HTMLElement, options: TerminalOptions): TerminalHandle {
    // Ligatures require the @xterm/addon-ligatures package — pluggable later.
    // For v0.1 the option is accepted but inert; we drop it here.
    void options.ligatures;

    const term = new Terminal({
      fontFamily: options.fontFamily,
      fontSize: options.fontSize,
      lineHeight: options.lineHeight ?? 1.2,
      scrollback: options.scrollback,
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: true,
      theme: toXtermTheme(options.theme),
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new SearchAddon());

    // Subscribers want the actual fitted grid size so the PTY can match it
    // exactly — guessing from pixel math misaligns the program's TUI.
    const resizeListeners = new Set<(cols: number, rows: number) => void>();
    const notifyResize = () => {
      for (const cb of resizeListeners) cb(term.cols, term.rows);
    };
    const safeFit = () => {
      try {
        fit.fit();
        notifyResize();
      } catch {
        // Container may not be sized yet; ResizeObserver will refit.
      }
    };

    term.open(container);
    safeFit();

    const ro = new ResizeObserver(safeFit);
    ro.observe(container);

    const handle: TerminalHandle = {
      write(data) {
        term.write(data as string);
      },
      onData(callback) {
        const sub = term.onData(callback);
        return () => sub.dispose();
      },
      onResize(callback) {
        resizeListeners.add(callback);
        // Emit the current size immediately so a late subscriber syncs at once.
        callback(term.cols, term.rows);
        return () => resizeListeners.delete(callback);
      },
      resize(cols, rows) {
        term.resize(cols, rows);
      },
      setTheme(theme) {
        term.options.theme = toXtermTheme(theme);
      },
      focus() {
        term.focus();
      },
      dispose() {
        ro.disconnect();
        term.dispose();
      },
      get dimensions() {
        return { cols: term.cols, rows: term.rows };
      },
    };

    return handle;
  }
}
