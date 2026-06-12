import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerFileDropTarget,
  shellEscapePath,
  shellEscapePaths,
  __testing__,
} from "./file-drop";

const { onDragDropEventMock } = vi.hoisted(() => ({
  onDragDropEventMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: onDragDropEventMock }),
}));

function makeTarget(rect: { left: number; top: number; right: number; bottom: number }) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}

beforeEach(() => {
  __testing__.reset();
  onDragDropEventMock.mockReset().mockResolvedValue(() => {});
});

afterEach(() => {
  __testing__.reset();
  document.body.innerHTML = "";
});

describe("shellEscapePath", () => {
  it("leaves plain absolute paths untouched", () => {
    expect(shellEscapePath("/Users/m/dev/file.png")).toBe("/Users/m/dev/file.png");
  });

  it("single-quotes paths with spaces (screenshots)", () => {
    expect(shellEscapePath("/tmp/Screenshot 2026-06-10 at 9.37.39 PM.png")).toBe(
      "'/tmp/Screenshot 2026-06-10 at 9.37.39 PM.png'"
    );
  });

  it("escapes embedded single quotes", () => {
    expect(shellEscapePath("/tmp/it's here.png")).toBe("'/tmp/it'\\''s here.png'");
  });

  it("joins multiple paths with spaces", () => {
    expect(shellEscapePaths(["/a/b.png", "/c d/e.png"])).toBe("/a/b.png '/c d/e.png'");
  });
});

describe("file-drop subscription", () => {
  it("logs when the drag-drop listen call fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    onDragDropEventMock.mockRejectedValueOnce(new Error("no webview"));

    const el = makeTarget({ left: 0, top: 0, right: 10, bottom: 10 });
    registerFileDropTarget(el, { onPaths: vi.fn() });
    await vi.waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith(
        "[file-drop] failed to subscribe to drag-drop events",
        expect.any(Error)
      )
    );
    errSpy.mockRestore();
  });
});

describe("file-drop target routing", () => {
  it("delivers dropped paths to the target under the cursor", () => {
    const onPaths = vi.fn();
    const el = makeTarget({ left: 0, top: 0, right: 100, bottom: 100 });
    registerFileDropTarget(el, { onPaths });

    __testing__.handleEvent({ type: "drop", paths: ["/tmp/a.png"], position: { x: 50, y: 50 } });
    expect(onPaths).toHaveBeenCalledWith(["/tmp/a.png"]);
  });

  it("ignores drops outside every target", () => {
    const onPaths = vi.fn();
    const el = makeTarget({ left: 0, top: 0, right: 100, bottom: 100 });
    registerFileDropTarget(el, { onPaths });

    __testing__.handleEvent({ type: "drop", paths: ["/tmp/a.png"], position: { x: 500, y: 500 } });
    expect(onPaths).not.toHaveBeenCalled();
  });

  it("routes to the correct pane among several", () => {
    const left = vi.fn();
    const right = vi.fn();
    registerFileDropTarget(makeTarget({ left: 0, top: 0, right: 100, bottom: 100 }), {
      onPaths: left,
    });
    registerFileDropTarget(makeTarget({ left: 100, top: 0, right: 200, bottom: 100 }), {
      onPaths: right,
    });

    __testing__.handleEvent({ type: "drop", paths: ["/x"], position: { x: 150, y: 10 } });
    expect(left).not.toHaveBeenCalled();
    expect(right).toHaveBeenCalledWith(["/x"]);
  });

  it("converts physical coordinates using devicePixelRatio", () => {
    const onPaths = vi.fn();
    registerFileDropTarget(makeTarget({ left: 0, top: 0, right: 100, bottom: 100 }), { onPaths });
    const original = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    try {
      // Physical (150, 150) → logical (75, 75): inside the 100×100 target.
      __testing__.handleEvent({ type: "drop", paths: ["/x"], position: { x: 150, y: 150 } });
      expect(onPaths).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "devicePixelRatio", { value: original, configurable: true });
    }
  });

  it("signals hover state on enter/over and clears on leave", () => {
    const onDragState = vi.fn();
    registerFileDropTarget(makeTarget({ left: 0, top: 0, right: 100, bottom: 100 }), {
      onPaths: vi.fn(),
      onDragState,
    });

    __testing__.handleEvent({ type: "enter", paths: ["/x"], position: { x: 10, y: 10 } });
    expect(onDragState).toHaveBeenLastCalledWith(true);
    __testing__.handleEvent({ type: "over", position: { x: 20, y: 20 } });
    // Same target: no duplicate notification.
    expect(onDragState).toHaveBeenCalledTimes(1);
    __testing__.handleEvent({ type: "leave" });
    expect(onDragState).toHaveBeenLastCalledWith(false);
  });

  it("moves hover between targets as the drag travels", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerFileDropTarget(makeTarget({ left: 0, top: 0, right: 100, bottom: 100 }), {
      onPaths: vi.fn(),
      onDragState: a,
    });
    registerFileDropTarget(makeTarget({ left: 100, top: 0, right: 200, bottom: 100 }), {
      onPaths: vi.fn(),
      onDragState: b,
    });

    __testing__.handleEvent({ type: "over", position: { x: 50, y: 50 } });
    expect(a).toHaveBeenLastCalledWith(true);
    __testing__.handleEvent({ type: "over", position: { x: 150, y: 50 } });
    expect(a).toHaveBeenLastCalledWith(false);
    expect(b).toHaveBeenLastCalledWith(true);
  });

  it("clears hover when the drop lands", () => {
    const onDragState = vi.fn();
    registerFileDropTarget(makeTarget({ left: 0, top: 0, right: 100, bottom: 100 }), {
      onPaths: vi.fn(),
      onDragState,
    });
    __testing__.handleEvent({ type: "enter", paths: ["/x"], position: { x: 10, y: 10 } });
    __testing__.handleEvent({ type: "drop", paths: ["/x"], position: { x: 10, y: 10 } });
    expect(onDragState).toHaveBeenLastCalledWith(false);
  });

  it("skips disconnected elements", () => {
    const onPaths = vi.fn();
    const el = makeTarget({ left: 0, top: 0, right: 100, bottom: 100 });
    registerFileDropTarget(el, { onPaths });
    el.remove();
    __testing__.handleEvent({ type: "drop", paths: ["/x"], position: { x: 10, y: 10 } });
    expect(onPaths).not.toHaveBeenCalled();
  });

  it("drops with no paths are a no-op", () => {
    const onPaths = vi.fn();
    registerFileDropTarget(makeTarget({ left: 0, top: 0, right: 100, bottom: 100 }), { onPaths });
    __testing__.handleEvent({ type: "drop", paths: [], position: { x: 10, y: 10 } });
    expect(onPaths).not.toHaveBeenCalled();
  });

  it("unregister removes the target and clears stale hover", () => {
    const onPaths = vi.fn();
    const off = registerFileDropTarget(
      makeTarget({ left: 0, top: 0, right: 100, bottom: 100 }),
      { onPaths }
    );
    __testing__.handleEvent({ type: "enter", paths: ["/x"], position: { x: 10, y: 10 } });
    off();
    expect(__testing__.targetCount()).toBe(0);
    __testing__.handleEvent({ type: "drop", paths: ["/x"], position: { x: 10, y: 10 } });
    expect(onPaths).not.toHaveBeenCalled();
  });

  it("isSubscribed reflects live unlisten state", () => {
    expect(__testing__.isSubscribed()).toBe(false);
    registerFileDropTarget(makeTarget({ left: 0, top: 0, right: 10, bottom: 10 }), { onPaths: vi.fn() });
    // subscription is async — still false synchronously
    expect(__testing__.isSubscribed()).toBe(false);
  });
});
