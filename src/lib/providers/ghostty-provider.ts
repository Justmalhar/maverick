// libghostty Rust FFI implementation — stub for v0.2
import type {
  TerminalProvider,
  TerminalHandle,
  TerminalOptions,
} from "../terminal-provider";

export class GhosttyProvider implements TerminalProvider {
  mount(_container: HTMLElement, _options: TerminalOptions): TerminalHandle {
    throw new Error("GhosttyProvider: not available until v0.2");
  }
}
