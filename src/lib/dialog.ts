// Native folder picker via Tauri's dialog plugin, with a graceful fallback
// for the Vite-only dev workflow (the plugin throws if Tauri isn't present).
import { open } from "@tauri-apps/plugin-dialog";

export async function pickProjectFolder(): Promise<string | null> {
  try {
    const picked = await open({
      multiple: false,
      directory: true,
      title: "Choose a project folder",
    });
    if (typeof picked === "string") return picked;
    return null;
  } catch {
    // Tauri not running (browser-only) — fall back to manual prompt.
    const path = window.prompt("Project root path");
    return path?.trim() || null;
  }
}
