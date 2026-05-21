import type { TerminalTheme } from "./ipc";

export interface TerminalOptions {
  theme: TerminalTheme;
  fontSize: number;
  fontFamily: string;
  ligatures: boolean;
  scrollback: number;
}

export interface TerminalHandle {
  write(data: string | Uint8Array): void;
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
