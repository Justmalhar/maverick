import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

export function mockInvoke(map: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>) {
  vi.mocked(invoke).mockImplementation((async (cmd: string, args?: Record<string, unknown>) => {
    if (!(cmd in map)) {
      throw new Error(`Unmocked invoke: ${cmd}`);
    }
    const v = map[cmd];
    if (typeof v === "function") {
      return (v as (a: Record<string, unknown>) => unknown)(args ?? {});
    }
    return v;
  }) as unknown as typeof invoke);
}

type EventMap = Record<string, unknown>;
type EventCallback = (event: { payload: unknown }) => void;

export function mockListen(eventToPayload: EventMap = {}, options: { capture?: Map<string, EventCallback> } = {}) {
  const captured = options.capture ?? new Map<string, EventCallback>();
  vi.mocked(listen).mockImplementation((async (event: string, cb: EventCallback) => {
    captured.set(event, cb);
    if (event in eventToPayload) {
      Promise.resolve().then(() => cb({ payload: eventToPayload[event] }));
    }
    return (() => {
      captured.delete(event);
    }) as UnlistenFn;
  }) as unknown as typeof listen);
  return captured;
}

export function resetTauriMocks() {
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(() => {});
}
