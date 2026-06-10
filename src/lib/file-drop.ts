// Native file drag-and-drop → terminal paths.
//
// Tauri (dragDropEnabled defaults to true) swallows OS file drags before the
// DOM ever sees them, so HTML5 drop handlers never fire inside the webview.
// The only way to receive dropped files is the webview-level drag-drop event,
// which reports physical cursor coordinates + absolute file paths. This module
// owns a single app-wide subscription and routes events to the registered drop
// target under the cursor (terminal panes), Terminal.app-style.
import { getCurrentWebview } from "@tauri-apps/api/webview";

export interface FileDropHandlers {
  // Absolute paths of the dropped files.
  onPaths: (paths: string[]) => void;
  // Hover feedback while a drag is over (true) / off (false) this target.
  onDragState?: (over: boolean) => void;
}

interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
  position?: { x: number; y: number };
}

// Paths that are pasted into a shell prompt must survive word-splitting —
// screenshots ("Screenshot 2026-06-10 at 9.37.39 PM.png") are full of spaces.
export function shellEscapePath(path: string): string {
  if (/^[A-Za-z0-9_/.:@%+=,-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, "'\\''")}'`;
}

export function shellEscapePaths(paths: string[]): string {
  return paths.map(shellEscapePath).join(" ");
}

const targets = new Map<HTMLElement, FileDropHandlers>();
let unlisten: (() => void) | null = null;
let subscribing: Promise<void> | null = null;
let hovered: HTMLElement | null = null;

// Tauri reports physical pixels; DOM rects are logical (CSS) pixels.
function toClientPoint(position: { x: number; y: number }): { x: number; y: number } {
  const scale = window.devicePixelRatio || 1;
  return { x: position.x / scale, y: position.y / scale };
}

function targetAt(position: { x: number; y: number } | undefined): HTMLElement | null {
  if (!position) return null;
  const { x, y } = toClientPoint(position);
  // Last registrant wins on overlap (matches stacking order of mounts).
  let hit: HTMLElement | null = null;
  for (const el of targets.keys()) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) hit = el;
  }
  return hit;
}

function setHovered(next: HTMLElement | null): void {
  if (hovered === next) return;
  if (hovered) targets.get(hovered)?.onDragState?.(false);
  hovered = next;
  if (hovered) targets.get(hovered)?.onDragState?.(true);
}

function handleEvent(payload: DragDropPayload): void {
  switch (payload.type) {
    case "enter":
    case "over":
      setHovered(targetAt(payload.position));
      break;
    case "drop": {
      const target = targetAt(payload.position);
      setHovered(null);
      const paths = payload.paths ?? [];
      if (target && paths.length > 0) targets.get(target)?.onPaths(paths);
      break;
    }
    case "leave":
      setHovered(null);
      break;
  }
}

function ensureSubscribed(): void {
  if (unlisten || subscribing) return;
  subscribing = getCurrentWebview()
    .onDragDropEvent((event) => handleEvent(event.payload as DragDropPayload))
    .then((off) => {
      // All targets may have unregistered while the listen call was in flight.
      if (targets.size === 0) off();
      else unlisten = off;
    })
    .catch((err) => {
      console.error("[file-drop] failed to subscribe to drag-drop events", err);
    })
    .finally(() => {
      subscribing = null;
    });
}

function teardownIfIdle(): void {
  if (targets.size > 0) return;
  hovered = null;
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}

/**
 * Register an element as a file-drop target. Returns the unregister function.
 * The webview subscription is created lazily with the first target and torn
 * down with the last, so windows without terminals pay nothing.
 */
export function registerFileDropTarget(
  el: HTMLElement,
  handlers: FileDropHandlers
): () => void {
  targets.set(el, handlers);
  ensureSubscribed();
  return () => {
    if (hovered === el) hovered = null;
    targets.delete(el);
    teardownIfIdle();
  };
}

export const __testing__ = {
  handleEvent,
  targetCount: () => targets.size,
  isSubscribed: () => unlisten !== null,
  reset: () => {
    targets.clear();
    hovered = null;
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
  },
};
