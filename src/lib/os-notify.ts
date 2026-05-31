import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let cachedGranted = false;

/** Test-only: reset the positive permission cache between specs. */
export function __resetOsNotifyCache(): void {
  cachedGranted = false;
}

async function ensurePermission(): Promise<boolean> {
  // Cache only the positive result: a transient denial (e.g. the OS prompt
  // dismissed while the window was unfocused) must not disable notifications for
  // the rest of the session, so we re-check/re-prompt until we get a grant.
  if (cachedGranted) return true;
  let ok = await isPermissionGranted();
  if (!ok) ok = (await requestPermission()) === "granted";
  cachedGranted = ok;
  return ok;
}

/**
 * Best-effort OS-native notification. Requests permission once if needed
 * (positive-only cache) and silently no-ops when the plugin is unavailable
 * (e.g. browser dev preview).
 */
export async function dispatchOsNotification(title: string, body: string): Promise<boolean> {
  try {
    if (!(await ensurePermission())) return false;
    sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}
