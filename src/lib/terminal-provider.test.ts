import { describe, it, expect, beforeEach } from "vitest";
import { TerminalRegistry, type TerminalProvider, type TerminalHandle, type TerminalOptions } from "./terminal-provider";

function makeProvider(): TerminalProvider {
  return {
    mount(_c: HTMLElement, _o: TerminalOptions): TerminalHandle {
      return {
        write() {}, resize() {}, setTheme() {}, focus() {}, dispose() {},
        get dimensions() { return { cols: 80, rows: 24 }; },
      };
    },
  };
}

describe("TerminalRegistry", () => {
  beforeEach(() => {
    // Reset internal singleton — Registry is module-level; reset via a sentinel provider
    TerminalRegistry.register(makeProvider());
  });

  it("get returns the registered provider", () => {
    expect(TerminalRegistry.get()).toBeDefined();
    expect(typeof TerminalRegistry.get().mount).toBe("function");
  });

  it("register replaces the provider", () => {
    const p = makeProvider();
    TerminalRegistry.register(p);
    expect(TerminalRegistry.get()).toBe(p);
  });

  it("throws when get is called before register", async () => {
    const mod = await import("./terminal-provider");
    // forcibly clear by registering then resetting via the internal module state:
    // we cannot null-out _provider directly, so we approximate the unregistered case
    // by inspecting that the error path exists.
    const original = mod.TerminalRegistry.get();
    // emulate uninitialized by overriding then asserting throw behavior
    (mod.TerminalRegistry as unknown as { register: (p: TerminalProvider | null) => void }).register(null as unknown as TerminalProvider);
    expect(() => mod.TerminalRegistry.get()).toThrow(/No TerminalProvider registered/);
    mod.TerminalRegistry.register(original);
  });
});
