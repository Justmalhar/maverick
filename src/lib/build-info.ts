/**
 * Build-time provenance, injected by Vite `define` (see vite.config.ts).
 * Falls back to safe sentinels so dev/test builds — where the defines are not
 * applied — never render `undefined`.
 */
export function appVersion(): string {
  return import.meta.env.VITE_APP_VERSION ?? "0.0.0";
}

export function appCommit(): string {
  return import.meta.env.VITE_APP_COMMIT ?? "dev";
}

export function versionLabel(): string {
  return `Maverick ${appVersion()} (${appCommit()})`;
}
