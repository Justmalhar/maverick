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

export interface TerminalProvider {
  mount(container: HTMLElement, options: TerminalOptions): TerminalHandle;
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
