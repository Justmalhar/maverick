import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

export interface WindowFocusState {
  /** True while the Tauri Window has OS focus. */
  focused: boolean;
  /** True while the WebView document is visible (not minimised / hidden tab). */
  visible: boolean;
}

export function initialFocus(): boolean {
  return typeof document !== "undefined" ? document.hasFocus() : true;
}

export function initialVisible(): boolean {
  return typeof document !== "undefined" ? document.visibilityState !== "hidden" : true;
}

/**
 * Tracks whether the app Window is focused and the document visible. Focus comes
 * from Tauri's `onFocusChanged` (authoritative across spaces / other apps);
 * visibility from the Page Visibility API (minimise / occlusion). Notification
 * routing reads both to decide OS-notification vs in-app toast vs silent.
 */
export function useWindowFocus(): WindowFocusState {
  const [focused, setFocused] = useState(initialFocus);
  const [visible, setVisible] = useState(initialVisible);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload }) => setFocused(payload))
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {});

    const onVisibility = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      unlisten?.();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { focused, visible };
}
