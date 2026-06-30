import { getMonaco } from "./monaco/loader";

let warmed = false;

/**
 * Boot Monaco + the highlighter and pull the text-viewer chunks during idle
 * time so the first file open finds them ready instead of paying the boot cost
 * on the critical path. Idempotent — safe to call on every EditorArea mount.
 */
export function prewarmEditor(): void {
  if (warmed) return;
  warmed = true;
  const run = () => {
    void getMonaco();
    void import("@/components/viewers/FileTabPane");
    void import("@/components/viewers/CodeViewer");
  };
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void })
    .requestIdleCallback;
  if (ric) ric(run);
  else setTimeout(run, 0);
}

/** Test-only: reset the idempotency latch so each test starts cold. */
export function __resetPrewarm(): void {
  warmed = false;
}
