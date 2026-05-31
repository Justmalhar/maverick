import type { Notification } from "@/lib/ipc";

/**
 * What the renderer should surface for an incoming `notification:send`. History
 * (the NotificationBell) is updated unconditionally and is intentionally not
 * encoded here — this only governs the transient OS / toast surfaces.
 */
export type NotificationAction = "os" | "toast" | "suppress";

export interface RouteInput {
  notification: Notification;
  /** Tauri Window currently has OS focus. */
  focused: boolean;
  /** WebView document is visible (not minimised / occluded). */
  visible: boolean;
  /** Id of the workspace tab the user is currently looking at, if any. */
  activeWorkspaceId: string | null;
}

/**
 * Focus/visibility-aware routing policy (ported from terax's route.ts):
 *
 * - Unfocused or hidden → fire an OS-native notification (the user is away).
 * - Focused + visible, and the notification targets the workspace the user is
 *   already looking at → suppress entirely (they can see the result).
 * - Focused + visible, but a different / unscoped workspace → in-app toast.
 *
 * A null `workspaceId` notification is treated as global and only suppressed
 * when nothing demands attention; while focused it surfaces as a toast.
 */
export function routeNotification({
  notification,
  focused,
  visible,
  activeWorkspaceId,
}: RouteInput): NotificationAction {
  if (!focused || !visible) return "os";
  const target = notification.workspaceId;
  if (target !== null && target === activeWorkspaceId) return "suppress";
  return "toast";
}
